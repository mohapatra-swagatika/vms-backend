const { Brackets, In } = require('typeorm');
const { repo, repoByEntityType } = require('../index');

function activeAssignment(alias = 'ura') {
  return `(${alias}.expires_at IS NULL OR ${alias}.expires_at > NOW())`;
}

function assignmentQb(alias = 'ura') {
  return repo('UserRoleAssignment').createQueryBuilder(alias);
}

function companyIdsInTowerSubquery(scopeId) {
  return repo('Company')
    .createQueryBuilder('c')
    .select('c.id')
    .where('c.tower_id = :scopeId', { scopeId });
}

function locationIdsInOrgSubquery(scopeId) {
  return repo('Location')
    .createQueryBuilder('l')
    .select('l.id')
    .where('l.organization_id = :scopeId', { scopeId });
}

function companyTowerIdSubquery(entityId) {
  return repo('Company')
    .createQueryBuilder('co')
    .select('co.tower_id')
    .where('co.id = :entityId', { entityId });
}

function locationOrgIdSubquery(entityId) {
  return repo('Location')
    .createQueryBuilder('lo')
    .select('lo.organization_id')
    .where('lo.id = :entityId', { entityId });
}

function mergePermissionRows(permissionRows) {
  const allowed = new Set();
  const denied = new Set();

  for (const row of permissionRows) {
    const perms = row.permissions ?? row;
    const { actions = [], not_actions = [] } = perms || {};
    actions.forEach((a) => allowed.add(a));
    not_actions.forEach((a) => denied.add(a));
  }

  denied.forEach((a) => allowed.delete(a));
  return { allowed: [...allowed], denied: [...denied] };
}

async function getMaxAssignmentLevel(userId) {
  const row = await assignmentQb('ura')
    .innerJoin('ura.role', 'r')
    .select('MAX(r.level)', 'max_level')
    .where('ura.user_id = :userId', { userId })
    .andWhere(activeAssignment('ura'))
    .getRawOne();

  return parseInt(row?.max_level ?? 0, 10) || 0;
}

async function getUserTopScope(userId) {
  const row = await assignmentQb('ura')
    .innerJoin('ura.role', 'r')
    .select('ura.scope_type', 'scope_type')
    .addSelect('ura.scope_id', 'scope_id')
    .addSelect('r.level', 'level')
    .addSelect('r.name', 'role_name')
    .addSelect('r.entity_type', 'entity_type')
    .where('ura.user_id = :userId', { userId })
    .andWhere(activeAssignment('ura'))
    .orderBy('r.level', 'DESC')
    .limit(1)
    .getRawOne();

  return row || null;
}

async function findActiveAssignments(userId, { orderByLevel = false, activeOnly = true } = {}) {
  const qb = assignmentQb('ura')
    .innerJoinAndSelect('ura.role', 'r')
    .where('ura.user_id = :userId', { userId });

  if (activeOnly) qb.andWhere(activeAssignment('ura'));
  if (orderByLevel) qb.orderBy('r.level', 'DESC');

  return qb.getMany();
}

function formatAssignmentRow(ura) {
  return {
    id: ura.id,
    scope_type: ura.scope_type,
    scope_id: ura.scope_id,
    assigned_at: ura.assigned_at,
    expires_at: ura.expires_at,
    role_name: ura.role.name,
    display_name: ura.role.display_name,
    level: ura.role.level,
    is_system: ura.role.is_system,
  };
}

async function getVisibleUserIds(scopeType, scopeId) {
  const qb = assignmentQb('ura').select('DISTINCT ura.user_id', 'user_id');

  if (scopeType === 'tower') {
    const sub = companyIdsInTowerSubquery(scopeId);
    qb.where('ura.scope_type = :tower AND ura.scope_id = :scopeId', { tower: 'tower', scopeId })
      .orWhere(`ura.scope_type = :company AND ura.scope_id IN (${sub.getQuery()})`)
      .setParameters({ ...sub.getParameters(), tower: 'tower', company: 'company', scopeId });
  } else if (scopeType === 'organization') {
    const sub = locationIdsInOrgSubquery(scopeId);
    qb.where('ura.scope_type = :org AND ura.scope_id = :scopeId', { org: 'organization', scopeId })
      .orWhere(`ura.scope_type = :loc AND ura.scope_id IN (${sub.getQuery()})`)
      .setParameters({ ...sub.getParameters(), org: 'organization', loc: 'location', scopeId });
  } else if (scopeType === 'company' || scopeType === 'location') {
    qb.where('ura.scope_type = :scopeType AND ura.scope_id = :scopeId', { scopeType, scopeId });
  } else {
    return [];
  }

  const rows = await qb.getRawMany();
  return rows.map((r) => r.user_id);
}

async function fetchScopedPermissions(userId, scopeType, scopeId) {
  const companySub = companyTowerIdSubquery(scopeId);
  const locationSub = locationOrgIdSubquery(scopeId);
  const resolvedScopeType = scopeType || 'global';

  const rows = await assignmentQb('ura')
    .innerJoin('ura.role', 'r')
    .select('r.permissions', 'permissions')
    .where('ura.user_id = :userId', { userId })
    .andWhere(activeAssignment('ura'))
    .andWhere(new Brackets((b) => {
      b.where('ura.scope_type = :global')
        .orWhere('(ura.scope_type = :scopeType AND ura.scope_id = :scopeId)')
        .orWhere(`(ura.scope_type = :tower AND :scopeType = :company AND ura.scope_id = (${companySub.getQuery()}))`)
        .orWhere(`(ura.scope_type = :organization AND :scopeType = :location AND ura.scope_id = (${locationSub.getQuery()}))`);
    }))
    .setParameters({
      userId,
      global: 'global',
      scopeType: resolvedScopeType,
      scopeId: scopeId || null,
      tower: 'tower',
      company: 'company',
      organization: 'organization',
      location: 'location',
      ...companySub.getParameters(),
      ...locationSub.getParameters(),
    })
    .getRawMany();

  return rows;
}

async function fetchAllActivePermissions(userId) {
  return assignmentQb('ura')
    .innerJoin('ura.role', 'r')
    .select('r.permissions', 'permissions')
    .where('ura.user_id = :userId', { userId })
    .andWhere(activeAssignment('ura'))
    .getRawMany();
}

async function countActiveAssignmentsForRole(roleId) {
  return assignmentQb('ura')
    .where('ura.role_id = :roleId', { roleId })
    .andWhere(activeAssignment('ura'))
    .getCount();
}

function applyScopeVisibilityToScopedEntityQb(qb, scope, alias = 'e') {
  if (!scope?.scope_id) {
    qb.andWhere('1 = 0');
    return qb;
  }

  if (scope.scope_type === 'tower') {
    const sub = companyIdsInTowerSubquery(scope.scope_id);
    qb.andWhere(new Brackets((b) => {
      b.where(`(${alias}.entity_type = :tower AND ${alias}.entity_id = :scopeId)`, {
        tower: 'tower',
        scopeId: scope.scope_id,
      }).orWhere(`(${alias}.entity_type = :company AND ${alias}.entity_id IN (${sub.getQuery()}))`);
    })).setParameters({
      ...qb.getParameters(),
      ...sub.getParameters(),
      tower: 'tower',
      company: 'company',
      scopeId: scope.scope_id,
    });
  } else if (scope.scope_type === 'organization') {
    const sub = locationIdsInOrgSubquery(scope.scope_id);
    qb.andWhere(new Brackets((b) => {
      b.where(`(${alias}.entity_type = :org AND ${alias}.entity_id = :scopeId)`, {
        org: 'organization',
        scopeId: scope.scope_id,
      }).orWhere(`(${alias}.entity_type = :loc AND ${alias}.entity_id IN (${sub.getQuery()}))`);
    })).setParameters({
      ...qb.getParameters(),
      ...sub.getParameters(),
      org: 'organization',
      loc: 'location',
      scopeId: scope.scope_id,
    });
  } else if (scope.scope_type === 'company') {
    qb.andWhere(`${alias}.entity_type = :company AND ${alias}.entity_id = :scopeId`, {
      company: 'company',
      scopeId: scope.scope_id,
    });
  } else if (scope.scope_type === 'location') {
    qb.andWhere(`${alias}.entity_type = :location AND ${alias}.entity_id = :scopeId`, {
      location: 'location',
      scopeId: scope.scope_id,
    });
  } else {
    qb.andWhere('1 = 0');
  }

  return qb;
}

async function resolveEntityNames(records) {
  if (!records.length) return records;

  const idsByType = {
    tower: new Set(),
    company: new Set(),
    organization: new Set(),
    location: new Set(),
  };

  for (const record of records) {
    idsByType[record.entity_type]?.add(record.entity_id);
  }

  const nameMap = new Map();
  await Promise.all(
    Object.entries(idsByType).map(async ([entityType, idSet]) => {
      const ids = [...idSet];
      if (!ids.length) return;
      const rows = await repoByEntityType(entityType).find({
        where: { id: In(ids) },
        select: { id: true, name: true },
      });
      for (const row of rows) nameMap.set(`${entityType}:${row.id}`, row.name);
    }),
  );

  return records.map((record) => ({
    ...record,
    entity_name: nameMap.get(`${record.entity_type}:${record.entity_id}`) ?? null,
  }));
}

module.exports = {
  activeAssignment,
  assignmentQb,
  mergePermissionRows,
  getMaxAssignmentLevel,
  getUserTopScope,
  findActiveAssignments,
  formatAssignmentRow,
  getVisibleUserIds,
  fetchScopedPermissions,
  fetchAllActivePermissions,
  countActiveAssignmentsForRole,
  applyScopeVisibilityToScopedEntityQb,
  applyScopeVisibilityToEmployeeQb: applyScopeVisibilityToScopedEntityQb,
  resolveEntityNames,
};
