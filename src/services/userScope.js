const { repo } = require('../db');
const {
  getMaxAssignmentLevel,
  getUserTopScope,
  getVisibleUserIds: queryVisibleUserIds,
} = require('../db/queries/assignments');

/** Minimum role level for the VMS Admin portal (admin and above). */
const MIN_ADMIN_PORTAL_LEVEL = (() => {
  const raw = process.env.MIN_ADMIN_PORTAL_LEVEL;
  const level = raw != null && raw !== '' ? parseInt(raw, 10) : 400;
  return Number.isFinite(level) ? level : 400;
})();

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

  const rows = await repo('Role')
    .createQueryBuilder('r')
    .where('r.level <= :cap', { cap })
    .andWhere('r.level > 0')
    .orderBy('r.level', 'DESC')
    .getMany();

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

  const ids = await queryVisibleUserIds(top.scope_type, top.scope_id);
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
  MIN_ADMIN_PORTAL_LEVEL,
  getMaxAssignmentLevel,
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
