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
const { uploadBuffer, profileKey } = require('../services/storage');

// GET /users  — scope-filtered: only returns users visible to the requester
router.get('/', auth, can('user:read'), async (req, res) => {
  try {
    // ── Step 1: Find the requester's most powerful active role assignment ──
    const { rows: myRoles } = await pool.query(`
      SELECT ura.scope_type, ura.scope_id, r.level, r.entity_type
      FROM   user_role_assignments ura
      JOIN   roles r ON r.id = ura.role_id
      WHERE  ura.user_id = $1
        AND  (ura.expires_at IS NULL OR ura.expires_at > now())
      ORDER  BY r.level DESC
      LIMIT  1
    `, [req.user.id]);

    const top = myRoles[0];

    // ── Step 2: Determine which user IDs are visible ──────────────────────
    // Support (≥1000) or global-scoped role → see everyone
    const isGlobal = !top || top.level >= 1000 || top.scope_type === 'global';

    let allowedIds = null; // null = no restriction

    if (!isGlobal && !top.scope_id) {
      // Scoped role but no scope_id set — incomplete assignment; show only themselves
      allowedIds = [req.user.id];
    } else if (!isGlobal && top.scope_id) {
      let visibleRows;

      if (top.scope_type === 'tower') {
        // Tower admin: users assigned to this tower OR any of its companies
        ({ rows: visibleRows } = await pool.query(`
          SELECT DISTINCT ura.user_id
          FROM   user_role_assignments ura
          WHERE  (ura.scope_type = 'tower'   AND ura.scope_id = $1)
             OR  (ura.scope_type = 'company' AND ura.scope_id IN (
                   SELECT id FROM companies WHERE tower_id = $1
                 ))
        `, [top.scope_id]));

      } else if (top.scope_type === 'organization') {
        // Org admin: users assigned to this org OR any of its locations
        ({ rows: visibleRows } = await pool.query(`
          SELECT DISTINCT ura.user_id
          FROM   user_role_assignments ura
          WHERE  (ura.scope_type = 'organization' AND ura.scope_id = $1)
             OR  (ura.scope_type = 'location'     AND ura.scope_id IN (
                   SELECT id FROM locations WHERE organization_id = $1
                 ))
        `, [top.scope_id]));

      } else if (top.scope_type === 'company') {
        // Company admin: users assigned to this specific company
        ({ rows: visibleRows } = await pool.query(`
          SELECT DISTINCT ura.user_id
          FROM   user_role_assignments ura
          WHERE  ura.scope_type = 'company' AND ura.scope_id = $1
        `, [top.scope_id]));

      } else if (top.scope_type === 'location') {
        // Location admin: users assigned to this specific location
        ({ rows: visibleRows } = await pool.query(`
          SELECT DISTINCT ura.user_id
          FROM   user_role_assignments ura
          WHERE  ura.scope_type = 'location' AND ura.scope_id = $1
        `, [top.scope_id]));

      } else {
        // 'any' entity_type (e.g. admin role not bound to specific entity) → no filter
        visibleRows = null;
      }

      if (visibleRows) {
        allowedIds = visibleRows.map(r => r.user_id);
        // Always include the requesting user themselves
        if (!allowedIds.includes(req.user.id)) allowedIds.push(req.user.id);
      }
    }

    // ── Step 3: Fetch users with optional ID filter ───────────────────────
    const hasFilter = !isGlobal && allowedIds !== null;

    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.phone, u.is_active, u.created_at, u.profile_image_url,
             COALESCE(json_agg(
               json_build_object(
                 'role_name', r.name, 'display_name', r.display_name,
                 'level', r.level, 'scope_type', ura.scope_type,
                 'scope_id', ura.scope_id, 'expires_at', ura.expires_at
               )
             ) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
      FROM   users u
      LEFT   JOIN user_role_assignments ura ON ura.user_id = u.id
        AND  (ura.expires_at IS NULL OR ura.expires_at > now())
      LEFT   JOIN roles r ON r.id = ura.role_id
      ${hasFilter ? 'WHERE u.id = ANY($1::uuid[])' : ''}
      GROUP  BY u.id
      ORDER  BY u.created_at DESC
    `, hasFilter ? [allowedIds] : []);

    res.json({ users: rows });
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
    res.json(rows[0]);
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

    const key = profileKey(req.params.id, req.file.originalname);
    const imageUrl = await uploadBuffer({
      key,
      buffer:      req.file.buffer,
      contentType: req.file.mimetype,
    });
    const { rows } = await pool.query(
      `UPDATE users SET profile_image_url = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, email, name, phone, is_active, created_at, profile_image_url`,
      [imageUrl, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0], profile_image_url: imageUrl });
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
