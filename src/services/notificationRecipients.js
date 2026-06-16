const { repo } = require('../db');
const { activeAssignment } = require('../db/queries/assignments');
const { getRecipientLevelBands } = require('./recipientLevels');

const ENTITY_SCOPE_TYPE = {
  tower: 'tower',
  organization: 'organization',
  company: 'company',
  location: 'location',
};

/**
 * Users assigned directly to this entity (same scope_type + scope_id only).
 * Does not include child company/location staff on parent tower/org config.
 */
async function queryRecipientsByLevel(minLevel, maxLevel, scopeType, scopeId) {
  return repo('User')
    .createQueryBuilder('u')
    .distinctOn(['u.id'])
    .select([
      'u.id',
      'u.name',
      'u.email',
      'r.level',
      'r.name',
      'r.display_name',
    ])
    .innerJoin('user_role_assignments', 'ura', 'ura.user_id = u.id')
    .innerJoin('roles', 'r', 'r.id = ura.role_id')
    .where('r.level >= :minLevel', { minLevel })
    .andWhere('r.level <= :maxLevel', { maxLevel })
    .andWhere('ura.scope_type = :scopeType', { scopeType })
    .andWhere('ura.scope_id = :scopeId', { scopeId })
    .andWhere(activeAssignment('ura'))
    .orderBy('u.id', 'ASC')
    .addOrderBy('r.level', 'DESC')
    .getRawMany()
    .then((rows) => rows.map((row) => ({
      id: row.u_id,
      name: row.u_name,
      email: row.u_email,
      level: row.r_level,
      role_name: row.r_name,
      role_display: row.r_display_name,
    })));
}

async function fetchTierRecipients(tier, scopeType, scopeId) {
  const bands = getRecipientLevelBands();
  const band = bands[tier];
  return queryRecipientsByLevel(band.min, band.max, scopeType, scopeId);
}

async function getNotificationRecipients(entityType, entityId) {
  const bands = getRecipientLevelBands();
  const scopeType = ENTITY_SCOPE_TYPE[entityType];
  const empty = { gate: [], front_desk: [], admin: [], level_bands: bands };

  if (!scopeType) return empty;

  const [gate, front_desk, admin] = await Promise.all([
    fetchTierRecipients('gate', scopeType, entityId),
    fetchTierRecipients('front_desk', scopeType, entityId),
    fetchTierRecipients('admin', scopeType, entityId),
  ]);

  return { gate, front_desk, admin, level_bands: bands };
}

module.exports = {
  getNotificationRecipients,
  getRecipientLevelBands,
};
