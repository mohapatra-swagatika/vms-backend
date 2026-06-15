const { getEffectivePermissions, getAllPermissions } = require('../services/permissions');

/**
 * can(action) — checks whether the requesting user holds the given action
 * in ANY of their active role assignments (scope-independent union).
 *
 * For scoped enforcement (e.g. "can the user manage *this* company?") pass
 * scopeType / scopeId explicitly via query or body and use canScoped() instead.
 */
function can(action) {
  return async (req, res, next) => {
    try {
      const perms = await getAllPermissions(req.user.id);
      if (perms.allowed.includes(action)) return next();
      return res.status(403).json({ error: `Missing permission: ${action}` });
    } catch (err) {
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * canScoped(action) — scope-filtered check.
 * Reads scopeType / scopeId from request query or body.
 * Falls back to getAllPermissions when no scope is provided (same as can()).
 */
function canScoped(action) {
  return async (req, res, next) => {
    try {
      const scopeType = req.query.scopeType || req.body.scopeType;
      const scopeId   = req.query.scopeId   || req.body.scopeId   || null;
      const perms = scopeType
        ? await getEffectivePermissions(req.user.id, scopeType, scopeId)
        : await getAllPermissions(req.user.id);
      if (perms.allowed.includes(action)) return next();
      return res.status(403).json({ error: `Missing permission: ${action}` });
    } catch (err) {
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { can, canScoped };
