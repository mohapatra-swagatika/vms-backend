const pool = require('../db/pool');
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
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (u.id)
       u.id, u.name, u.email, r.level, r.name AS role_name, r.display_name AS role_display
     FROM users u
     JOIN user_role_assignments ura ON ura.user_id = u.id
     JOIN roles r ON r.id = ura.role_id
     WHERE r.level >= $1 AND r.level <= $2
       AND ura.scope_type = $3
       AND ura.scope_id = $4
       AND (ura.expires_at IS NULL OR ura.expires_at > now())
     ORDER BY u.id, r.level DESC`,
    [minLevel, maxLevel, scopeType, scopeId],
  );
  return rows;
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
