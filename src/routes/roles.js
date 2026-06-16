const router = require('express').Router();
const { repo, isUniqueViolation } = require('../db');
const { countActiveAssignmentsForRole } = require('../db/queries/assignments');
const auth   = require('../middleware/auth');
const { can } = require('../middleware/rbac');
const { invalidateCache } = require('../services/permissions');
const { getAssignableRoles } = require('../services/userScope');
const { getAllPermissions } = require('../services/permissions');
const { getPermissionCatalog } = require('../services/permissionCatalog');
const { listRoles } = require('../services/roleList');

// GET /roles/permissions — full catalog for role create/edit UI
router.get('/permissions', auth, async (req, res) => {
  try {
    const perms = await getAllPermissions(req.user.id);
    const allowed = perms.allowed;
    const canList = ['role:read', 'role:create', 'role:update'].some(p => allowed.includes(p));
    if (!canList) {
      return res.status(403).json({ error: 'Missing permission to list available permissions' });
    }

    const permissions = await getPermissionCatalog();
    res.json({ permissions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load permissions' });
  }
});

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

// GET /roles  — includes user_count per role, with search/filter/pagination
router.get('/', auth, can('role:read'), async (req, res) => {
  try {
    const result = await listRoles(req.query);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

// GET /roles/:id
router.get('/:id', auth, can('role:read'), async (req, res) => {
  try {
    const role = await repo('Role').findOne({ where: { id: req.params.id } });
    if (!role) return res.status(404).json({ error: 'Role not found' });
    res.json(role);
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

    const roleRepo = repo('Role');
    const role = roleRepo.create({
      name,
      display_name,
      level,
      permissions,
      parent_role_id: parent_role_id || null,
      entity_type: entity_type || 'any',
      entity_id: entity_id || null,
      created_by: req.user.id,
    });
    const saved = await roleRepo.save(role);
    res.status(201).json(saved);
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: 'Role name already exists' });
    res.status(500).json({ error: 'Failed to create role' });
  }
});

// PUT /roles/:id
router.put('/:id', auth, can('role:update'), async (req, res) => {
  try {
    const roleRepo = repo('Role');
    const existing = await roleRepo.findOne({
      where: { id: req.params.id },
      select: { id: true, is_system: true },
    });
    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.is_system) return res.status(403).json({ error: 'System roles cannot be modified' });

    const { display_name, level, permissions, parent_role_id } = req.body;
    await roleRepo.update(req.params.id, {
      ...(display_name != null && { display_name }),
      ...(level != null && { level }),
      ...(permissions != null && { permissions }),
      ...(parent_role_id != null && { parent_role_id }),
    });
    const updated = await roleRepo.findOne({ where: { id: req.params.id } });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /roles/:id
router.delete('/:id', auth, can('role:delete'), async (req, res) => {
  try {
    const roleRepo = repo('Role');
    const existing = await roleRepo.findOne({
      where: { id: req.params.id },
      select: { id: true, is_system: true },
    });
    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.is_system) return res.status(403).json({ error: 'System roles cannot be deleted' });

    const usageCount = await countActiveAssignmentsForRole(req.params.id);
    if (usageCount > 0)
      return res.status(409).json({
        error: `Cannot delete: ${usageCount} user(s) still have this role assigned. Remove those assignments first.`,
        user_count: usageCount,
      });

    await roleRepo.delete(req.params.id);

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
