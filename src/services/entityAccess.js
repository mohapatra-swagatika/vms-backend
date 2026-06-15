const pool = require('../db/pool');
const { getUserTopScope, isGlobalScope } = require('./userScope');

/** True when the user may manage the given entity (within their scope). */
async function canAccessEntity(userId, entityType, entityId) {
  const scope = await getUserTopScope(userId);
  if (isGlobalScope(scope)) return true;

  if (entityType === 'tower') {
    return scope.scope_type === 'tower' && scope.scope_id === entityId;
  }

  if (entityType === 'company') {
    if (scope.scope_type === 'company' && scope.scope_id === entityId) return true;
    if (scope.scope_type === 'tower' && scope.scope_id) {
      const { rows } = await pool.query('SELECT tower_id FROM companies WHERE id = $1', [entityId]);
      return rows[0]?.tower_id === scope.scope_id;
    }
    return false;
  }

  if (entityType === 'organization') {
    return scope.scope_type === 'organization' && scope.scope_id === entityId;
  }

  if (entityType === 'location') {
    if (scope.scope_type === 'location' && scope.scope_id === entityId) return true;
    if (scope.scope_type === 'organization' && scope.scope_id) {
      const { rows } = await pool.query('SELECT organization_id FROM locations WHERE id = $1', [entityId]);
      return rows[0]?.organization_id === scope.scope_id;
    }
    return false;
  }

  return false;
}

module.exports = { canAccessEntity };
