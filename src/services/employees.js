const pool = require('../db/pool');
const { getUserTopScope, isGlobalScope } = require('./userScope');
const { canAccessEntity } = require('./entityAccess');

const ENTITY_TYPES = ['tower', 'company', 'organization', 'location'];
const ENTITY_TABLES = {
  tower: 'towers',
  company: 'companies',
  organization: 'organizations',
  location: 'locations',
};

const ENTITY_NAME_SQL = `
  CASE e.entity_type
    WHEN 'tower' THEN (SELECT name FROM towers WHERE id = e.entity_id)
    WHEN 'company' THEN (SELECT name FROM companies WHERE id = e.entity_id)
    WHEN 'organization' THEN (SELECT name FROM organizations WHERE id = e.entity_id)
    WHEN 'location' THEN (SELECT name FROM locations WHERE id = e.entity_id)
  END
`;

function parseBool(val) {
  if (val === undefined || val === null || val === '') return undefined;
  if (val === 'true' || val === '1' || val === true) return true;
  if (val === 'false' || val === '0' || val === false) return false;
  return undefined;
}

/** SQL fragment + params restricting employees to entities visible to the user. */
async function buildVisibilityClause(userId, startIdx = 1) {
  const scope = await getUserTopScope(userId);
  if (isGlobalScope(scope)) return { clause: 'TRUE', params: [], nextIdx: startIdx };

  const idx = startIdx;
  if (scope.scope_type === 'tower' && scope.scope_id) {
    return {
      clause: `(
        (e.entity_type = 'tower' AND e.entity_id = $${idx})
        OR (e.entity_type = 'company' AND e.entity_id IN (
          SELECT id FROM companies WHERE tower_id = $${idx}
        ))
      )`,
      params: [scope.scope_id],
      nextIdx: idx + 1,
    };
  }

  if (scope.scope_type === 'organization' && scope.scope_id) {
    return {
      clause: `(
        (e.entity_type = 'organization' AND e.entity_id = $${idx})
        OR (e.entity_type = 'location' AND e.entity_id IN (
          SELECT id FROM locations WHERE organization_id = $${idx}
        ))
      )`,
      params: [scope.scope_id],
      nextIdx: idx + 1,
    };
  }

  if (scope.scope_type === 'company' && scope.scope_id) {
    return {
      clause: `(e.entity_type = 'company' AND e.entity_id = $${idx})`,
      params: [scope.scope_id],
      nextIdx: idx + 1,
    };
  }

  if (scope.scope_type === 'location' && scope.scope_id) {
    return {
      clause: `(e.entity_type = 'location' AND e.entity_id = $${idx})`,
      params: [scope.scope_id],
      nextIdx: idx + 1,
    };
  }

  return { clause: 'FALSE', params: [], nextIdx: startIdx };
}

/** Filter employees by exact entity type (and optional specific entity). No child union. */
function buildEntityFilterClause(entityType, entityId, startIdx = 1) {
  const idx = startIdx;
  return {
    clause: `e.entity_type = $${idx} AND e.entity_id = $${idx + 1}`,
    params: [entityType, entityId],
    nextIdx: idx + 2,
  };
}

/** Type-only filter — all employees of that entity type, no child entities included. */
function buildEntityTypeFilterClause(entityType, startIdx = 1) {
  const idx = startIdx;
  return {
    clause: `e.entity_type = $${idx}`,
    params: [entityType],
    nextIdx: idx + 1,
  };
}

async function assertEntityExists(entityType, entityId) {
  const table = ENTITY_TABLES[entityType];
  if (!table) throw Object.assign(new Error('Invalid entity type'), { status: 400 });
  const { rows } = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [entityId]);
  if (!rows[0]) throw Object.assign(new Error('Entity not found'), { status: 404 });
}

async function getEmployeeById(id) {
  const { rows } = await pool.query(
    `SELECT e.*, ${ENTITY_NAME_SQL} AS entity_name
     FROM employees e WHERE e.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function assertCanAccessEmployee(userId, employee) {
  if (!employee) throw Object.assign(new Error('Employee not found'), { status: 404 });
  const allowed = await canAccessEntity(userId, employee.entity_type, employee.entity_id);
  if (!allowed) throw Object.assign(new Error('You do not have access to this employee'), { status: 403 });
  return employee;
}

async function listEmployees(userId, query = {}) {
  const {
    entity_type: entityType,
    entity_id: entityId,
    search,
    department,
    is_active: isActiveRaw,
    page: pageRaw = '1',
    limit: limitRaw = '20',
  } = query;

  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitRaw, 10) || 20));
  const offset = (page - 1) * limit;
  const isActive = parseBool(isActiveRaw);

  const conditions = [];
  const params = [];
  let idx = 1;

  const vis = await buildVisibilityClause(userId, idx);
  conditions.push(vis.clause);
  params.push(...vis.params);
  idx = vis.nextIdx;

  if (entityType) {
    if (!ENTITY_TYPES.includes(entityType)) {
      throw Object.assign(new Error('Invalid entity_type filter'), { status: 400 });
    }
    if (entityId) {
      const allowed = await canAccessEntity(userId, entityType, entityId);
      if (!allowed) throw Object.assign(new Error('You do not have access to this entity'), { status: 403 });
      const filter = buildEntityFilterClause(entityType, entityId, idx);
      conditions.push(filter.clause);
      params.push(...filter.params);
      idx = filter.nextIdx;
    } else {
      const filter = buildEntityTypeFilterClause(entityType, idx);
      conditions.push(filter.clause);
      params.push(...filter.params);
      idx = filter.nextIdx;
    }
  }

  if (department) {
    conditions.push(`e.department ILIKE $${idx}`);
    params.push(`%${department}%`);
    idx += 1;
  }

  if (isActive !== undefined) {
    conditions.push(`e.is_active = $${idx}`);
    params.push(isActive);
    idx += 1;
  }

  if (search) {
    conditions.push(`(
      e.name ILIKE $${idx}
      OR COALESCE(e.email, '') ILIKE $${idx}
      OR COALESCE(e.phone, '') ILIKE $${idx}
      OR COALESCE(e.employee_code, '') ILIKE $${idx}
      OR COALESCE(e.department, '') ILIKE $${idx}
      OR COALESCE(e.job_title, '') ILIKE $${idx}
    )`);
    params.push(`%${search}%`);
    idx += 1;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS total FROM employees e ${where}`;
  const { rows: countRows } = await pool.query(countSql, params);
  const total = countRows[0]?.total ?? 0;

  const listSql = `
    SELECT e.*, ${ENTITY_NAME_SQL} AS entity_name
    FROM employees e
    ${where}
    ORDER BY e.name ASC
    LIMIT $${idx} OFFSET $${idx + 1}
  `;
  const { rows } = await pool.query(listSql, [...params, limit, offset]);

  return {
    employees: rows,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) || 0 },
  };
}

async function createEmployee(userId, data) {
  const {
    entity_type: entityType,
    entity_id: entityId,
    name,
    email,
    phone,
    employee_code: employeeCode,
    department,
    job_title: jobTitle,
    is_active: isActive = true,
  } = data;

  if (!ENTITY_TYPES.includes(entityType)) {
    throw Object.assign(new Error('Invalid entity_type'), { status: 400 });
  }
  if (!entityId) throw Object.assign(new Error('entity_id is required'), { status: 400 });
  if (!name?.trim()) throw Object.assign(new Error('name is required'), { status: 400 });

  const allowed = await canAccessEntity(userId, entityType, entityId);
  if (!allowed) throw Object.assign(new Error('You do not have access to this entity'), { status: 403 });

  await assertEntityExists(entityType, entityId);

  try {
    const { rows } = await pool.query(
      `INSERT INTO employees
         (entity_type, entity_id, employee_code, name, email, phone, department, job_title, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        entityType,
        entityId,
        employeeCode?.trim() || null,
        name.trim(),
        email?.trim() || null,
        phone?.trim() || null,
        department?.trim() || null,
        jobTitle?.trim() || null,
        isActive !== false,
        userId,
      ]
    );
    const employee = await getEmployeeById(rows[0].id);
    return employee;
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(new Error('An employee with this email already exists for this entity'), { status: 409 });
    }
    throw err;
  }
}

async function updateEmployee(userId, id, data) {
  const existing = await assertCanAccessEmployee(userId, await getEmployeeById(id));

  const fields = [];
  const params = [];
  let idx = 1;

  const allowed = {
    employee_code: 'employee_code',
    name: 'name',
    email: 'email',
    phone: 'phone',
    department: 'department',
    job_title: 'job_title',
    is_active: 'is_active',
  };

  for (const [key, col] of Object.entries(allowed)) {
    if (data[key] !== undefined) {
      let val = data[key];
      if (typeof val === 'string') val = val.trim();
      if (key === 'email' && val === '') val = null;
      if (key === 'employee_code' && val === '') val = null;
      if (key === 'phone' && val === '') val = null;
      if (key === 'department' && val === '') val = null;
      if (key === 'job_title' && val === '') val = null;
      if (key === 'name' && !val) throw Object.assign(new Error('name cannot be empty'), { status: 400 });
      fields.push(`${col} = $${idx}`);
      params.push(val);
      idx += 1;
    }
  }

  if (!fields.length) return existing;

  fields.push('updated_at = now()');
  params.push(id);

  try {
    await pool.query(
      `UPDATE employees SET ${fields.join(', ')} WHERE id = $${idx}`,
      params
    );
    return getEmployeeById(id);
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(new Error('An employee with this email already exists for this entity'), { status: 409 });
    }
    throw err;
  }
}

async function deleteEmployee(userId, id) {
  await assertCanAccessEmployee(userId, await getEmployeeById(id));
  await pool.query('DELETE FROM employees WHERE id = $1', [id]);
  return { deleted: true };
}

async function insertEmployeeRow({ entityType, entityId, createdBy, row }) {
  const { rows } = await pool.query(
    `INSERT INTO employees
       (entity_type, entity_id, employee_code, name, email, phone, department, job_title, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      entityType,
      entityId,
      row.employeeCode || null,
      row.name,
      row.email || null,
      row.phone || null,
      row.department || null,
      row.jobTitle || null,
      createdBy,
    ]
  );
  return rows[0].id;
}

module.exports = {
  ENTITY_TYPES,
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  assertCanAccessEmployee,
  assertEntityExists,
  insertEmployeeRow,
};
