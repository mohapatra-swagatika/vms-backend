const router = require('express').Router();
const bcrypt = require('bcrypt');
const pool   = require('../db/pool');
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

// GET /users/:id
router.get('/:id', auth, can('user:read'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, name, phone, is_active, created_at, profile_image_url FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(await resolveProfile(rows[0]));
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

    const { buffer, contentType, ext } = await optimizeImage(req.file.buffer, req.file.mimetype);
    const key = profileKey(req.params.id, `upload${ext}`);
    const storageKey = await uploadBuffer({ key, buffer, contentType });
    const { rows } = await pool.query(
      `UPDATE users SET profile_image_url = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, email, name, phone, is_active, created_at, profile_image_url`,
      [storageKey, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    await pool.query(
      'INSERT INTO user_images (user_id, image_url) VALUES ($1, $2)',
      [req.params.id, storageKey]
    );
    const signedUrl = await resolveImageUrl(storageKey);
    res.json({ user: await resolveProfile(rows[0]), profile_image_url: signedUrl });
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
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, phone)
       VALUES ($1, $2, $3, $4) RETURNING id, email, name, phone, created_at`,
      [email.toLowerCase(), hash, name, phone || null]
    );
    const user = rows[0];

    // Assign role if provided
    if (role_name && scope_type) {
      const { rows: roleRows } = await pool.query(
        'SELECT id, level FROM roles WHERE name = $1', [role_name]
      );
      if (!roleRows[0]) return res.status(400).json({ error: 'Role not found' });
      if (!(await canAssignRoleLevel(req.user.id, roleRows[0].level))) {
        return res.status(403).json({ error: 'You cannot assign a role at or above your own level' });
      }
      await pool.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type, scope_id, assigned_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, roleRows[0].id, scope_type, scope_id || null, req.user.id]
      );
    }

    res.status(201).json({ user });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PATCH /users/:id
router.patch('/:id', auth, can('user:update'), async (req, res) => {
  try {
    // Block self-deactivation
    if (req.params.id === req.user.id && req.body.is_active === false)
      return res.status(403).json({ error: 'You cannot deactivate your own account.' });

    const { name, phone, email, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET
         name      = COALESCE($1, name),
         phone     = COALESCE($2, phone),
         email     = COALESCE($3, email),
         is_active = COALESCE($4, is_active),
         updated_at = now()
       WHERE id = $5
       RETURNING id, email, name, phone, is_active`,
      [name, phone, email ? email.toLowerCase() : null, is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    await invalidateCache(req.params.id);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /users/:id/reset-password
router.post('/:id/reset-password', auth, can('user:update'), async (req, res) => {
  try {
    let { password } = req.body;
    // If no password provided, generate one
    if (!password) {
      password = 'Vms-' + Math.random().toString(36).slice(2, 10) + '!';
    }
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS));
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = now()
       WHERE id = $2 RETURNING id, email, name`,
      [hash, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0], password });
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

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await invalidateCache(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// GET /users/:id/roles
router.get('/:id/roles', auth, can('role:read'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ura.id, ura.scope_type, ura.scope_id, ura.assigned_at, ura.expires_at,
             r.name as role_name, r.display_name, r.level, r.is_system
      FROM   user_role_assignments ura
      JOIN   roles r ON r.id = ura.role_id
      WHERE  ura.user_id = $1
      ORDER  BY r.level DESC
    `, [req.params.id]);
    res.json({ assignments: rows });
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

    const { rows: roleRows } = await pool.query('SELECT level FROM roles WHERE id = $1', [role_id]);
    if (!roleRows[0]) return res.status(404).json({ error: 'Role not found' });
    if (!(await canAssignRoleLevel(req.user.id, roleRows[0].level))) {
      return res.status(403).json({ error: 'You cannot assign a role at or above your own level' });
    }

    const { rows } = await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type, scope_id, assigned_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.params.id, role_id, scope_type, scope_id || null, req.user.id, expires_at || null]
    );
    await invalidateCache(req.params.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Assignment already exists' });
    res.status(500).json({ error: 'Failed to assign role' });
  }
});

// DELETE /users/:id/roles/:assignmentId
router.delete('/:id/roles/:assignmentId', auth, can('role:assign'), async (req, res) => {
  try {
    await pool.query('DELETE FROM user_role_assignments WHERE id = $1', [req.params.assignmentId]);
    await invalidateCache(req.params.id);
    res.json({ message: 'Role removed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove role' });
  }
});

module.exports = router;
