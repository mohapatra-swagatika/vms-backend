const { repo } = require('../db');
const { getUserTopScope } = require('../db/queries/assignments');
const { isGlobalScope } = require('./userScope');
const {
  getCompanyCountsByTower,
  getLocationCountsByOrganization,
} = require('../db/queries/entityMeta');

async function listTowers(userId) {
  const scope = await getUserTopScope(userId);
  const qb = repo('Tower').createQueryBuilder('t').orderBy('t.created_at', 'DESC');

  if (!isGlobalScope(scope)) {
    if (scope.scope_type === 'tower' && scope.scope_id) {
      qb.andWhere('t.id = :id', { id: scope.scope_id });
    } else {
      return [];
    }
  }

  const towers = await qb.getMany();
  const counts = await getCompanyCountsByTower(towers.map((t) => t.id));

  return towers.map((tower) => ({
    ...tower,
    company_count: counts[tower.id] ?? 0,
  }));
}

async function listOrganizations(userId) {
  const scope = await getUserTopScope(userId);
  const qb = repo('Organization').createQueryBuilder('o').orderBy('o.created_at', 'DESC');

  if (!isGlobalScope(scope)) {
    if (scope.scope_type === 'organization' && scope.scope_id) {
      qb.andWhere('o.id = :id', { id: scope.scope_id });
    } else {
      return [];
    }
  }

  const organizations = await qb.getMany();
  const counts = await getLocationCountsByOrganization(organizations.map((o) => o.id));

  return organizations.map((org) => ({
    ...org,
    location_count: counts[org.id] ?? 0,
  }));
}

async function listCompanies(userId, { towerId } = {}) {
  const scope = await getUserTopScope(userId);
  const qb = repo('Company')
    .createQueryBuilder('c')
    .leftJoin('c.tower', 't')
    .addSelect(['t.name'])
    .orderBy('c.created_at', 'DESC');

  if (towerId) qb.andWhere('c.tower_id = :towerId', { towerId });

  if (!isGlobalScope(scope)) {
    if (scope.scope_type === 'tower' && scope.scope_id) {
      qb.andWhere('c.tower_id = :scopeTowerId', { scopeTowerId: scope.scope_id });
    } else if (scope.scope_type === 'company' && scope.scope_id) {
      qb.andWhere('c.id = :scopeCompanyId', { scopeCompanyId: scope.scope_id });
    } else {
      return [];
    }
  }

  const { entities, raw } = await qb.getRawAndEntities();
  const rows = entities.map((company, index) => ({
    ...company,
    tower_name: raw[index]?.t_name ?? null,
  }));

  return rows;
}

async function listLocations(userId, { organizationId } = {}) {
  const scope = await getUserTopScope(userId);
  const qb = repo('Location')
    .createQueryBuilder('l')
    .leftJoin('l.organization', 'o')
    .addSelect(['o.name'])
    .orderBy('l.created_at', 'DESC');

  if (organizationId) qb.andWhere('l.organization_id = :organizationId', { organizationId });

  if (!isGlobalScope(scope)) {
    if (scope.scope_type === 'organization' && scope.scope_id) {
      qb.andWhere('l.organization_id = :scopeOrgId', { scopeOrgId: scope.scope_id });
    } else if (scope.scope_type === 'location' && scope.scope_id) {
      qb.andWhere('l.id = :scopeLocationId', { scopeLocationId: scope.scope_id });
    } else {
      return [];
    }
  }

  const { entities, raw } = await qb.getRawAndEntities();
  const rows = entities.map((location, index) => ({
    ...location,
    organization_name: raw[index]?.o_name ?? null,
  }));

  return rows;
}

module.exports = {
  listTowers,
  listOrganizations,
  listCompanies,
  listLocations,
};
