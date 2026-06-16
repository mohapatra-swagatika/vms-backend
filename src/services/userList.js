const { repo } = require('../db');
const {
  assignmentQb,
  activeAssignment,
} = require('../db/queries/assignments');
const { getVisibleUserIds } = require('./userScope');
const { resolveProfiles } = require('./storage');
const { parsePagination, paginationMeta } = require('./pagination');

async function resolveVisibleUserIds(requesterId) {
  const visible = await getVisibleUserIds(requesterId);
  if (visible === null) return { isGlobal: true, allowedIds: null };
  return { isGlobal: false, allowedIds: visible };
}

function buildUserListQuery({ isGlobal, allowedIds, search, isActiveRaw, role }) {
  const qb = repo('User').createQueryBuilder('u');

  if (!isGlobal && allowedIds !== null) {
    qb.andWhere('u.id IN (:...allowedIds)', { allowedIds });
  }

  if (search) {
    qb.andWhere('(u.name ILIKE :search OR u.email ILIKE :search)', { search: `%${search}%` });
  }

  if (isActiveRaw === 'true' || isActiveRaw === true) {
    qb.andWhere('u.is_active = true');
  } else if (isActiveRaw === 'false' || isActiveRaw === false) {
    qb.andWhere('u.is_active = false');
  }

  if (role) {
    const roleFilter = assignmentQb('ura_f')
      .innerJoin('ura_f.role', 'r_f')
      .select('1')
      .where('ura_f.user_id = u.id')
      .andWhere(activeAssignment('ura_f'))
      .andWhere('(r_f.display_name = :role OR r_f.name = :role)', { role });

    qb.andWhere(`EXISTS (${roleFilter.getQuery()})`)
      .setParameters({ ...qb.getParameters(), ...roleFilter.getParameters() });
  }

  return qb;
}

async function loadRolesForUsers(userIds) {
  if (!userIds.length) return new Map();

  const assignments = await assignmentQb('ura')
    .innerJoinAndSelect('ura.role', 'r')
    .where('ura.user_id IN (:...userIds)', { userIds })
    .andWhere(activeAssignment('ura'))
    .getMany();

  const rolesByUser = new Map(userIds.map((id) => [id, []]));
  for (const ura of assignments) {
    rolesByUser.get(ura.user_id).push({
      role_name: ura.role.name,
      display_name: ura.role.display_name,
      level: ura.role.level,
      scope_type: ura.scope_type,
      scope_id: ura.scope_id,
      expires_at: ura.expires_at,
    });
  }

  return rolesByUser;
}

async function listUsers(requesterId, queryParams = {}) {
  const { page, limit, offset } = parsePagination(queryParams);
  const { search, role, is_active: isActiveRaw } = queryParams;
  const { isGlobal, allowedIds } = await resolveVisibleUserIds(requesterId);

  const qb = buildUserListQuery({ isGlobal, allowedIds, search, isActiveRaw, role });
  const total = await qb.getCount();

  const users = await qb
    .orderBy('u.created_at', 'DESC')
    .skip(offset)
    .take(limit)
    .getMany();

  const rolesByUser = await loadRolesForUsers(users.map((user) => user.id));
  const rows = users.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    is_active: user.is_active,
    created_at: user.created_at,
    profile_image_url: user.profile_image_url,
    roles: rolesByUser.get(user.id) ?? [],
  }));

  return {
    users: await resolveProfiles(rows),
    pagination: paginationMeta(page, limit, total),
  };
}

module.exports = { listUsers, resolveVisibleUserIds };
