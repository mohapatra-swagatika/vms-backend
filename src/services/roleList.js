const { repo } = require('../db');
const { activeAssignment } = require('../db/queries/assignments');
const { parsePagination, paginationMeta } = require('./pagination');

async function listRoles(queryParams = {}) {
  const { page, limit, offset } = parsePagination(queryParams);
  const search = (queryParams.search || '').trim();
  const { is_system: isSystemRaw } = queryParams;

  const qb = repo('Role')
    .createQueryBuilder('r')
    .leftJoin('user_role_assignments', 'ura', `ura.role_id = r.id AND ${activeAssignment('ura')}`)
    .addSelect('COUNT(ura.id)', 'user_count')
    .groupBy('r.id')
    .orderBy('r.level', 'DESC')
    .addOrderBy('r.display_name', 'ASC');

  if (search) {
    qb.andWhere('(r.display_name ILIKE :search OR r.name ILIKE :search)', { search: `%${search}%` });
  }

  if (isSystemRaw === 'true' || isSystemRaw === true) {
    qb.andWhere('r.is_system = true');
  } else if (isSystemRaw === 'false' || isSystemRaw === false) {
    qb.andWhere('r.is_system = false');
  }

  const countQb = repo('Role').createQueryBuilder('r');
  if (search) {
    countQb.andWhere('(r.display_name ILIKE :search OR r.name ILIKE :search)', { search: `%${search}%` });
  }
  if (isSystemRaw === 'true' || isSystemRaw === true) {
    countQb.andWhere('r.is_system = true');
  } else if (isSystemRaw === 'false' || isSystemRaw === false) {
    countQb.andWhere('r.is_system = false');
  }
  const total = await countQb.getCount();

  const rawRows = await qb.offset(offset).limit(limit).getRawAndEntities();
  const roles = rawRows.entities.map((role, index) => ({
    ...role,
    user_count: parseInt(rawRows.raw[index]?.user_count ?? 0, 10) || 0,
  }));

  return {
    roles,
    pagination: paginationMeta(page, limit, total),
  };
}

module.exports = { listRoles };
