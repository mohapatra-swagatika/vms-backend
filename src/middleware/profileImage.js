const { getAllPermissions } = require('../services/permissions');
const { canManageUser } = require('../services/userScope');

/** Enforces image:upload_self (own profile) or image:upload_child (managed users). */
async function canUploadProfileImage(req, res, next) {
  try {
    const targetId = String(req.params.id);
    const isSelf = String(req.user.id) === targetId;
    const perms = await getAllPermissions(req.user.id);
    const allowed = perms.allowed;

    if (isSelf) {
      if (allowed.includes('image:upload_self')) return next();
      return res.status(403).json({ error: 'Missing permission: image:upload_self' });
    }

    if (!allowed.includes('image:upload_child')) {
      return res.status(403).json({ error: 'Missing permission: image:upload_child' });
    }

    if (!(await canManageUser(req.user.id, targetId))) {
      return res.status(403).json({ error: 'You do not have access to manage this user' });
    }

    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Permission check failed' });
  }
}

module.exports = { canUploadProfileImage };
