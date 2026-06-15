const { getAllPermissions } = require('../services/permissions');
const { getUserTopScope } = require('../services/userScope');
const { canAccessEntity } = require('../services/entityAccess');
const { getEmployeeById } = require('../services/employees');

/** Requires employee:csv_upload_self (own entity) or employee:csv_upload_child (managed entity). */
function canUploadEmployeeCsv(entityType) {
  return async (req, res, next) => {
    try {
      const perms = await getAllPermissions(req.user.id);
      const allowed = perms.allowed;
      const entityId = String(req.params.id);
      const scope = await getUserTopScope(req.user.id);

      const isSelf = scope?.scope_type === entityType && String(scope.scope_id) === entityId;

      if (isSelf) {
        if (!allowed.includes('employee:csv_upload_self')) {
          return res.status(403).json({ error: 'Missing permission: employee:csv_upload_self' });
        }
        return next();
      }

      if (!allowed.includes('employee:csv_upload_child')) {
        return res.status(403).json({ error: 'Missing permission: employee:csv_upload_child' });
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

/** Requires employee:create and access to entity in body or params. */
function canCreateEmployeeForEntity(entityTypeParam = null) {
  return async (req, res, next) => {
    try {
      const perms = await getAllPermissions(req.user.id);
      if (!perms.allowed.includes('employee:create')) {
        return res.status(403).json({ error: 'Missing permission: employee:create' });
      }

      const entityType = entityTypeParam || req.body.entity_type;
      const entityId = req.params.id || req.body.entity_id;
      if (!entityType || !entityId) {
        return res.status(400).json({ error: 'entity_type and entity_id are required' });
      }

      if (!(await canAccessEntity(req.user.id, entityType, String(entityId)))) {
        return res.status(403).json({ error: 'You do not have access to this entity' });
      }
      return next();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/** Requires employee:read and access to the employee record. */
async function canReadEmployee(req, res, next) {
  try {
    const perms = await getAllPermissions(req.user.id);
    if (!perms.allowed.includes('employee:read')) {
      return res.status(403).json({ error: 'Missing permission: employee:read' });
    }
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Permission check failed' });
  }
}

/** Requires employee:update and access to the employee record. */
async function canUpdateEmployee(req, res, next) {
  try {
    const perms = await getAllPermissions(req.user.id);
    if (!perms.allowed.includes('employee:update')) {
      return res.status(403).json({ error: 'Missing permission: employee:update' });
    }

    const employee = await getEmployeeById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (!(await canAccessEntity(req.user.id, employee.entity_type, employee.entity_id))) {
      return res.status(403).json({ error: 'You do not have access to this employee' });
    }
    req.employee = employee;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Permission check failed' });
  }
}

/** Requires employee:delete and access to the employee record. */
async function canDeleteEmployee(req, res, next) {
  try {
    const perms = await getAllPermissions(req.user.id);
    if (!perms.allowed.includes('employee:delete')) {
      return res.status(403).json({ error: 'Missing permission: employee:delete' });
    }

    const employee = await getEmployeeById(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    if (!(await canAccessEntity(req.user.id, employee.entity_type, employee.entity_id))) {
      return res.status(403).json({ error: 'You do not have access to this employee' });
    }
    req.employee = employee;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Permission check failed' });
  }
}

module.exports = {
  canUploadEmployeeCsv,
  canCreateEmployeeForEntity,
  canReadEmployee,
  canUpdateEmployee,
  canDeleteEmployee,
};
