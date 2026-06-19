const { getAllPermissions } = require('../services/permissions');
const { getUserTopScope } = require('../services/userScope');
const { canAccessEntity } = require('../services/entityAccess');

/** Requires image:delete_upload_self (own entity) or image:delete_upload_child (managed entity). */
function canDeleteEntityImage(entityType) {
  return async (req, res, next) => {
    try {
      req.entityType = entityType;
      const perms = await getAllPermissions(req.user.id);
      const allowed = perms.allowed;
      const entityId = String(req.params.id);
      const scope = await getUserTopScope(req.user.id);

      const isSelf = scope?.scope_type === entityType && String(scope.scope_id) === entityId;

      if (isSelf) {
        if (!allowed.includes('image:delete_upload_self')) {
          return res.status(403).json({ error: 'Missing permission: image:delete_upload_self' });
        }
        return next();
      }

      if (!allowed.includes('image:delete_upload_child')) {
        return res.status(403).json({ error: 'Missing permission: image:delete_upload_child' });
      }
      if (!(await canAccessEntity(req.user.id, entityType, entityId))) {
        return res.status(403).json({ error: 'You do not have access to manage this entity' });
      }
      return next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { canDeleteEntityImage };
