const router = require('express').Router();
const bcrypt = require('bcrypt');
const { repo, isUniqueViolation } = require('../db');
const {
  findActiveAssignments,
  formatAssignmentRow,
} = require('../db/queries/assignments');
const auth   = require('../middleware/auth');
const { can } = require('../middleware/rbac');
const { canUploadProfileImage } = require('../middleware/profileImage');
const { uploadProfileImage } = require('../middleware/upload');
const { invalidateCache } = require('../services/permissions');
const { canAssignRoleLevel } = require('../services/userScope');
const { deleteProfileImages } = require('../services/profileImages');
const { uploadBuffer, resolveProfile, resolveImageUrl, profileKey } = require('../services/storage');
const { optimizeImage } = require('../services/imageOptimize');
const { listUsers } = require('../services/userList');
const mobileAuth = require('../middleware/mobileAuth');
const { getUserGallery } = require('../services/userImages');
const { getDashboardGalleryForUser } = require('../services/entityImages');

const USER_PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  phone: true,
  is_active: true,
  created_at: true,
  profile_image_url: true,
};

// GET /users  — scope-filtered list with search, filters, pagination
router.get('/', auth, can('user:read'), async (req, res) => {
  try {
    const result = await listUsers(req.user.id, req.query);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// GET /users/me — logged-in mobile user details
router.get('/me', mobileAuth, async (req, res) => {
  try {
    const gallery = await getUserGallery(req.user.id);
    if (!gallery) return res.status(404).json({ error: 'User not found' });
    res.json(gallery.user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// GET /users/me/images — entity gallery for the user's scoped entity (same as admin dashboard)
router.get('/me/images', mobileAuth, async (req, res) => {
  try {
    const gallery = await getDashboardGalleryForUser(req.user.id);
    res.json(gallery);
  } catch (err) {
    console.error(err);
    if (err.code === '42P01') {
      return res.status(500).json({ error: 'Image storage not ready. Run database migrations.' });
    }
    res.status(500).json({ error: 'Failed to load entity images' });
  }
});

// GET /users/:id
router.get('/:id', auth, can('user:read'), async (req, res) => {
  try {
    const user = await repo('User').findOne({
      where: { id: req.params.id },
      select: USER_PUBLIC_FIELDS,
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(await resolveProfile(user));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Remove previous profile object before saving the new one.
async function clearOldProfileImages(req, _res, next) {
  try {
    await deleteProfileImages(req.params.id);
    next();
  } catch (err) {
    next(err);
  }
}

// POST /users/:id/profile-image
router.post('/:id/profile-image', auth, canUploadProfileImage, clearOldProfileImages, uploadProfileImage, async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'No image file provided' });

    const userRepo = repo('User');
    const { buffer, contentType, ext } = await optimizeImage(req.file.buffer, req.file.mimetype);
    const key = profileKey(req.params.id, `upload${ext}`);
    const storageRef = await uploadBuffer({ key, buffer, contentType });

    await userRepo.update(req.params.id, { profile_image_url: storageRef });
    const user = await userRepo.findOne({
      where: { id: req.params.id },
      select: USER_PUBLIC_FIELDS,
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await repo('UserImage').save({
      user_id: req.params.id,
      image_url: storageRef,
    });

    const signedUrl = await resolveImageUrl(storageRef);
    res.json({ user: await resolveProfile(user), profile_image_url: signedUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to upload profile image' });
  }
});

// POST /users  — create user
router.post('/', auth, can('user:create'), async (req, res) => {
  try {
    const { email, password, name, phone, role_name, scope_type, scope_id } = req.body;
    if (!email || !password || !name)
      return res.status(400).json({ error: 'email, password, name required' });

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS));
    const userRepo = repo('User');
    const user = userRepo.create({
      email: email.toLowerCase(),
      password_hash: hash,
      name,
      phone: phone || null,
    });
    const saved = await userRepo.save(user);

    if (role_name && scope_type) {
      const role = await repo('Role').findOne({
        where: { name: role_name },
        select: { id: true, level: true },
      });
      if (!role) return res.status(400).json({ error: 'Role not found' });
      if (!(await canAssignRoleLevel(req.user.id, role.level))) {
        return res.status(403).json({ error: 'You cannot assign a role at or above your own level' });
      }
      await repo('UserRoleAssignment').save({
        user_id: saved.id,
        role_id: role.id,
        scope_type,
        scope_id: scope_id || null,
        assigned_by: req.user.id,
      });
    }

    const { password_hash, ...publicUser } = saved;
    res.status(201).json({
      user: {
        id: publicUser.id,
        email: publicUser.email,
        name: publicUser.name,
        phone: publicUser.phone,
        created_at: publicUser.created_at,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PATCH /users/:id
router.patch('/:id', auth, can('user:update'), async (req, res) => {
  try {
    if (req.params.id === req.user.id && req.body.is_active === false)
      return res.status(403).json({ error: 'You cannot deactivate your own account.' });

    const { name, phone, email, is_active } = req.body;
    const userRepo = repo('User');
    const existing = await userRepo.findOne({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'User not found' });

    await userRepo.update(req.params.id, {
      ...(name != null && { name }),
      ...(phone != null && { phone }),
      ...(email != null && { email: email.toLowerCase() }),
      ...(is_active != null && { is_active }),
    });

    const updated = await userRepo.findOne({
      where: { id: req.params.id },
      select: { id: true, email: true, name: true, phone: true, is_active: true },
    });
    await invalidateCache(req.params.id);
    res.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /users/:id/reset-password
router.post('/:id/reset-password', auth, can('user:update'), async (req, res) => {
  try {
    let { password } = req.body;
    if (!password) {
      password = 'Vms-' + Math.random().toString(36).slice(2, 10) + '!';
    }
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS));
    const userRepo = repo('User');
    const existing = await userRepo.findOne({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'User not found' });

    await userRepo.update(req.params.id, { password_hash: hash });
    res.json({
      user: { id: existing.id, email: existing.email, name: existing.name },
      password,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// DELETE /users/:id
router.delete('/:id', auth, can('user:delete'), async (req, res) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(403).json({ error: 'You cannot delete your own account.' });

    const result = await repo('User').delete(req.params.id);
    if (!result.affected) return res.status(404).json({ error: 'User not found' });
    await invalidateCache(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// GET /users/:id/roles
router.get('/:id/roles', auth, can('role:read'), async (req, res) => {
  try {
    const assignments = (await findActiveAssignments(req.params.id, {
      orderByLevel: true,
      activeOnly: false,
    })).map(formatAssignmentRow);
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// POST /users/:id/roles  — assign role
router.post('/:id/roles', auth, can('role:assign'), async (req, res) => {
  try {
    const { role_id, scope_type, scope_id, expires_at } = req.body;
    if (!role_id || !scope_type)
      return res.status(400).json({ error: 'role_id and scope_type required' });

    const role = await repo('Role').findOne({
      where: { id: role_id },
      select: { id: true, level: true },
    });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (!(await canAssignRoleLevel(req.user.id, role.level))) {
      return res.status(403).json({ error: 'You cannot assign a role at or above your own level' });
    }

    const assignmentRepo = repo('UserRoleAssignment');
    const assignment = assignmentRepo.create({
      user_id: req.params.id,
      role_id,
      scope_type,
      scope_id: scope_id || null,
      assigned_by: req.user.id,
      expires_at: expires_at || null,
    });
    const saved = await assignmentRepo.save(assignment);
    await invalidateCache(req.params.id);
    res.status(201).json(saved);
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Assignment already exists' });
    res.status(500).json({ error: 'Failed to assign role' });
  }
});

// DELETE /users/:id/roles/:assignmentId
router.delete('/:id/roles/:assignmentId', auth, can('role:assign'), async (req, res) => {
  try {
    await repo('UserRoleAssignment').delete(req.params.assignmentId);
    await invalidateCache(req.params.id);
    res.json({ message: 'Role removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove role' });
  }
});

module.exports = router;
