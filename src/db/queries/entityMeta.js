const { repo } = require('../index');

async function getLatestImageMap(entityType, entityIds) {
  if (!entityIds.length) return {};

  const rows = await repo('EntityImage')
    .createQueryBuilder('ei')
    .distinctOn(['ei.entity_id'])
    .select(['ei.entity_id', 'ei.image_url'])
    .where('ei.entity_type = :entityType', { entityType })
    .andWhere('ei.entity_id IN (:...entityIds)', { entityIds })
    .orderBy('ei.entity_id', 'ASC')
    .addOrderBy('ei.created_at', 'DESC')
    .getMany();

  return Object.fromEntries(rows.map((row) => [row.entity_id, row.image_url]));
}

async function attachLatestImages(entityType, rows) {
  if (!rows.length) return rows;
  const latestMap = await getLatestImageMap(entityType, rows.map((row) => row.id));
  return rows.map((row) => ({
    ...row,
    image_url: latestMap[row.id] ?? row.image_url ?? null,
  }));
}

async function getCompanyCountsByTower(towerIds) {
  if (!towerIds.length) return {};

  const rows = await repo('Company')
    .createQueryBuilder('c')
    .select('c.tower_id', 'tower_id')
    .addSelect('COUNT(*)', 'cnt')
    .where('c.tower_id IN (:...towerIds)', { towerIds })
    .groupBy('c.tower_id')
    .getRawMany();

  return Object.fromEntries(rows.map((row) => [row.tower_id, parseInt(row.cnt, 10) || 0]));
}

async function getLocationCountsByOrganization(orgIds) {
  if (!orgIds.length) return {};

  const rows = await repo('Location')
    .createQueryBuilder('l')
    .select('l.organization_id', 'organization_id')
    .addSelect('COUNT(*)', 'cnt')
    .where('l.organization_id IN (:...orgIds)', { orgIds })
    .groupBy('l.organization_id')
    .getRawMany();

  return Object.fromEntries(rows.map((row) => [row.organization_id, parseInt(row.cnt, 10) || 0]));
}

module.exports = {
  getLatestImageMap,
  attachLatestImages,
  getCompanyCountsByTower,
  getLocationCountsByOrganization,
};
