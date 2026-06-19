const { getAllPermissions } = require('../services/permissions');
const { getUserTopScope } = require('../services/userScope');

/** Requires image:upload_self on the user's own scoped entity only. */
function canUploadEntityProfileImage(entityType) {
  return async (req, res, next) => {
    try {
      req.entityType = entityType;
      const perms = await getAllPermissions(req.user.id);
      const allowed = perms.allowed;
      const entityId = String(req.params.id);
      const scope = await getUserTopScope(req.user.id);

      const isSelf = scope?.scope_type === entityType && String(scope.scope_id) === entityId;
      if (!isSelf) {
        return res.status(403).json({ error: 'You can only upload a profile image for your own entity' });
      }
      if (!allowed.includes('image:upload_self')) {
        return res.status(403).json({ error: 'Missing permission: image:upload_self' });
      }
      return next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { canUploadEntityProfileImage };
