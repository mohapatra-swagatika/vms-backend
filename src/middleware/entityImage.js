const { getAllPermissions } = require('../services/permissions');
const { canAccessEntity } = require('../services/entityAccess');

/** Requires image:upload_child and access to the target entity. Sets req.entityType before multer. */
function canUploadEntityImage(entityType) {
  return async (req, res, next) => {
    try {
      req.entityType = entityType;
      const perms = await getAllPermissions(req.user.id);
      if (!perms.allowed.includes('image:upload_child')) {
        return res.status(403).json({ error: 'Missing permission: image:upload_child' });
      }
      if (!(await canAccessEntity(req.user.id, entityType, req.params.id))) {
        return res.status(403).json({ error: 'You do not have access to manage this entity' });
      }
      return next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { canUploadEntityImage };
