const pool = require('../db/pool');

/** Returns the user's highest active role assignment, or null. */
async function getUserTopScope(userId) {
  const { rows } = await pool.query(`
    SELECT ura.scope_type, ura.scope_id, r.level, r.name AS role_name
    FROM   user_role_assignments ura
    JOIN   roles r ON r.id = ura.role_id
    WHERE  ura.user_id = $1
      AND  (ura.expires_at IS NULL OR ura.expires_at > now())
    ORDER  BY r.level DESC
    LIMIT  1
  `, [userId]);
  return rows[0] || null;
}

/** Support / no assignment → level 1000 (no ceiling). */
function getSelfLevel(scope) {
  return scope?.level ?? 1000;
}

/** Max role level for entity-scoped manager assignment (matches system role levels). */
const ENTITY_ROLE_CEILING = {
  tower: 800,
  organization: 800,
  company: 600,
  location: 600,
};

/** Max role level the user may grant: strictly below self, optionally capped further. */
function effectiveMaxLevel(selfLevel, maxLevel) {
  const selfMax = selfLevel - 1;
  if (maxLevel != null && !Number.isNaN(maxLevel)) {
    return Math.min(selfMax, maxLevel);
  }
  return selfMax;
}

function resolveAssignableCap(selfLevel, { maxLevel, entityType } = {}) {
  let cap = effectiveMaxLevel(selfLevel, maxLevel);
  if (entityType && ENTITY_ROLE_CEILING[entityType] != null) {
    cap = Math.min(cap, ENTITY_ROLE_CEILING[entityType]);
  }
  return cap;
}

/** Roles the requester is allowed to assign to others (strictly below own level). */
async function getAssignableRoles(userId, { maxLevel, entityType } = {}) {
  const scope = await getUserTopScope(userId);
  const selfLevel = getSelfLevel(scope);
  const cap = resolveAssignableCap(selfLevel, { maxLevel, entityType });

  const { rows } = await pool.query(`
    SELECT r.id, r.name, r.display_name, r.level, r.is_system
    FROM roles r
    WHERE r.level <= $1 AND r.level > 0
    ORDER BY r.level DESC
  `, [cap]);

  return {
    roles: rows,
    requester_level: selfLevel,
    max_assignable_level: cap,
  };
}

async function canAssignRoleLevel(userId, roleLevel, { maxLevel } = {}) {
  const scope = await getUserTopScope(userId);
  const cap = effectiveMaxLevel(getSelfLevel(scope), maxLevel);
  return roleLevel > 0 && roleLevel <= cap;
}

function isGlobalScope(top) {
  return !top || top.level >= 1000 || top.scope_type === 'global';
}

/** User IDs visible to the requester (same rules as GET /users). null = unrestricted. */
async function getVisibleUserIds(requesterId) {
  if (requesterId === undefined || requesterId === null) return [];

  const top = await getUserTopScope(requesterId);
  if (isGlobalScope(top)) return null;

  if (!top.scope_id) return [requesterId];

  let visibleRows;
  if (top.scope_type === 'tower') {
    ({ rows: visibleRows } = await pool.query(`
      SELECT DISTINCT ura.user_id
      FROM   user_role_assignments ura
      WHERE  (ura.scope_type = 'tower'   AND ura.scope_id = $1)
         OR  (ura.scope_type = 'company' AND ura.scope_id IN (
               SELECT id FROM companies WHERE tower_id = $1
             ))
    `, [top.scope_id]));
  } else if (top.scope_type === 'organization') {
    ({ rows: visibleRows } = await pool.query(`
      SELECT DISTINCT ura.user_id
      FROM   user_role_assignments ura
      WHERE  (ura.scope_type = 'organization' AND ura.scope_id = $1)
         OR  (ura.scope_type = 'location'     AND ura.scope_id IN (
               SELECT id FROM locations WHERE organization_id = $1
             ))
    `, [top.scope_id]));
  } else if (top.scope_type === 'company') {
    ({ rows: visibleRows } = await pool.query(`
      SELECT DISTINCT ura.user_id
      FROM   user_role_assignments ura
      WHERE  ura.scope_type = 'company' AND ura.scope_id = $1
    `, [top.scope_id]));
  } else if (top.scope_type === 'location') {
    ({ rows: visibleRows } = await pool.query(`
      SELECT DISTINCT ura.user_id
      FROM   user_role_assignments ura
      WHERE  ura.scope_type = 'location' AND ura.scope_id = $1
    `, [top.scope_id]));
  } else {
    return null;
  }

  const ids = visibleRows.map(r => r.user_id);
  if (!ids.includes(requesterId)) ids.push(requesterId);
  return ids;
}

/** True when requester may manage the target user (self or in visible scope). */
async function canManageUser(requesterId, targetUserId) {
  if (requesterId === targetUserId) return true;
  const visible = await getVisibleUserIds(requesterId);
  if (visible === null) return true;
  return visible.includes(targetUserId);
}

module.exports = {
  getUserTopScope,
  getSelfLevel,
  ENTITY_ROLE_CEILING,
  effectiveMaxLevel,
  resolveAssignableCap,
  getAssignableRoles,
  canAssignRoleLevel,
  isGlobalScope,
  getVisibleUserIds,
  canManageUser,
};
