const router = require('express').Router();
const pool   = require('../db/pool');
const auth   = require('../middleware/auth');
const { can } = require('../middleware/rbac');
const { invalidateCache } = require('../services/permissions');
const { getAssignableRoles } = require('../services/userScope');
const { getAllPermissions } = require('../services/permissions');

// GET /roles/assignable  — roles the requester may assign (strictly below own level)
router.get('/assignable', auth, async (req, res) => {
  try {
    const perms = await getAllPermissions(req.user.id);
    const allowed = perms.allowed;
    const canList = ['role:read', 'role:assign', 'user:create'].some(p => allowed.includes(p));
    if (!canList) {
      return res.status(403).json({ error: 'Missing permission to list assignable roles' });
    }

    const maxLevel = req.query.max_level != null ? parseInt(req.query.max_level, 10) : undefined;
    const entityType = req.query.entity_type || undefined;
    const result = await getAssignableRoles(req.user.id, { maxLevel, entityType });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch assignable roles' });
  }
});

// GET /roles  — includes user_count per role
router.get('/', auth, can('role:read'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*,
        COUNT(ura.id)::int AS user_count
      FROM roles r
      LEFT JOIN user_role_assignments ura ON ura.role_id = r.id
        AND (ura.expires_at IS NULL OR ura.expires_at > now())
      GROUP BY r.id
      ORDER BY r.level DESC
    `);
    res.json({ roles: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// GET /roles/:id
router.get('/:id', auth, can('role:read'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Role not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// POST /roles  — create custom role
router.post('/', auth, can('role:create'), async (req, res) => {
  try {
    const { name, display_name, level, permissions, parent_role_id, entity_type, entity_id } = req.body;
    if (!name || !display_name || !level || !permissions)
      return res.status(400).json({ error: 'name, display_name, level, permissions required' });

    const { rows } = await pool.query(
      `INSERT INTO roles (name, display_name, level, permissions, parent_role_id, entity_type, entity_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, display_name, level, JSON.stringify(permissions),
       parent_role_id || null, entity_type || 'any', entity_id || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Role name already exists' });
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PUT /roles/:id
router.put('/:id', auth, can('role:update'), async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT is_system FROM roles WHERE id = $1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Role not found' });
    if (existing[0].is_system) return res.status(403).json({ error: 'System roles cannot be modified' });

    const { display_name, level, permissions, parent_role_id } = req.body;
    const { rows } = await pool.query(
      `UPDATE roles SET display_name = COALESCE($1, display_name),
         level = COALESCE($2, level), permissions = COALESCE($3, permissions),
         parent_role_id = COALESCE($4, parent_role_id), updated_at = now()
       WHERE id = $5 RETURNING *`,
      [display_name, level, permissions ? JSON.stringify(permissions) : null, parent_role_id, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /roles/:id
router.delete('/:id', auth, can('role:delete'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT is_system FROM roles WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Role not found' });
    if (rows[0].is_system) return res.status(403).json({ error: 'System roles cannot be deleted' });

    // Block delete if active users have this role
    const { rows: usageRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM user_role_assignments
       WHERE role_id = $1 AND (expires_at IS NULL OR expires_at > now())`,
      [req.params.id]
    );
    if (usageRows[0].cnt > 0)
      return res.status(409).json({
        error: `Cannot delete: ${usageRows[0].cnt} user(s) still have this role assigned. Remove those assignments first.`,
        user_count: usageRows[0].cnt,
      });

    await pool.query('DELETE FROM roles WHERE id = $1', [req.params.id]);

    // Invalidate all permission caches (safest — role is gone)
    const { redis } = require('../services/permissions');
    const keys = await redis.keys('perm:*');
    if (keys.length) await redis.del(...keys);

    res.json({ message: 'Role deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

module.exports = router;
