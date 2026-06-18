const { repo } = require('../db');

const TABLE_BY_TYPE = {
  tower: 'towers',
  organization: 'organizations',
  company: 'companies',
  location: 'locations',
};

async function getParentEntity(entityType, entityId) {
  if (entityType === 'company') {
    const company = await repo('Company').findOne({
      where: { id: entityId },
      select: { tower_id: true },
    });
    if (company?.tower_id) return { type: 'tower', id: company.tower_id };
  }

  if (entityType === 'location') {
    const location = await repo('Location').findOne({
      where: { id: entityId },
      select: { organization_id: true },
    });
    if (location?.organization_id) {
      return { type: 'organization', id: location.organization_id };
    }
  }

  return null;
}

module.exports = {
  TABLE_BY_TYPE,
  getParentEntity,
};
