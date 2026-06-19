const { repo, repoByEntityType, isUniqueViolation } = require('../db');
const {
  getUserTopScope,
  isGlobalScope,
} = require('./userScope');
const {
  applyScopeVisibilityToScopedEntityQb,
  resolveEntityNames,
} = require('../db/queries/assignments');
const { canAccessEntity } = require('./entityAccess');

const ENTITY_TYPES = ['tower', 'company', 'organization', 'location'];

function parseBool(val) {
  if (val === undefined || val === null || val === '') return undefined;
  if (val === 'true' || val === '1' || val === true) return true;
  if (val === 'false' || val === '0' || val === false) return false;
  return undefined;
}

function employeeQb() {
  return repo('Employee').createQueryBuilder('e');
}

async function applyEmployeeVisibility(qb, userId) {
  const scope = await getUserTopScope(userId);
  if (isGlobalScope(scope)) return qb;
  return applyScopeVisibilityToScopedEntityQb(qb, scope);
}

async function assertEntityExists(entityType, entityId) {
  if (!ENTITY_TYPES.includes(entityType)) {
    throw Object.assign(new Error('Invalid entity type'), { status: 400 });
  }
  const found = await repoByEntityType(entityType).findOne({
    where: { id: entityId },
    select: { id: true },
  });
  if (!found) throw Object.assign(new Error('Entity not found'), { status: 404 });
}

async function getEmployeeById(id) {
  const employee = await repo('Employee').findOne({ where: { id } });
  if (!employee) return null;
  const [withName] = await resolveEntityNames([employee]);
  return withName;
}

async function assertCanAccessEmployee(userId, employee) {
  if (!employee) throw Object.assign(new Error('Employee not found'), { status: 404 });
  const allowed = await canAccessEntity(userId, employee.entity_type, employee.entity_id);
  if (!allowed) throw Object.assign(new Error('You do not have access to this employee'), { status: 403 });
  return employee;
}

function applyEmployeeFilters(qb, { entityType, entityId, search, department, isActive }) {
  if (entityType) {
    qb.andWhere('e.entity_type = :entityType', { entityType });
    if (entityId) qb.andWhere('e.entity_id = :entityId', { entityId });
  }

  if (department) {
    qb.andWhere('e.department ILIKE :department', { department: `%${department}%` });
  }

  if (isActive !== undefined) {
    qb.andWhere('e.is_active = :isActive', { isActive });
  }

  if (search) {
    qb.andWhere(`(
      e.name ILIKE :search
      OR COALESCE(e.email, '') ILIKE :search
      OR COALESCE(e.phone, '') ILIKE :search
      OR COALESCE(e.employee_code, '') ILIKE :search
      OR COALESCE(e.department, '') ILIKE :search
      OR COALESCE(e.job_title, '') ILIKE :search
    )`, { search: `%${search}%` });
  }

  return qb;
}

async function listEmployees(userId, queryParams = {}) {
  const {
    entity_type: entityType,
    entity_id: entityId,
    search,
    department,
    is_active: isActiveRaw,
    page: pageRaw = '1',
    limit: limitRaw = '20',
  } = queryParams;

  const page = Math.max(1, parseInt(pageRaw, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitRaw, 10) || 20));
  const offset = (page - 1) * limit;
  const isActive = parseBool(isActiveRaw);

  if (entityType && !ENTITY_TYPES.includes(entityType)) {
    throw Object.assign(new Error('Invalid entity_type filter'), { status: 400 });
  }

  if (entityType && entityId) {
    const allowed = await canAccessEntity(userId, entityType, entityId);
    if (!allowed) throw Object.assign(new Error('You do not have access to this entity'), { status: 403 });
  }

  let qb = employeeQb();
  qb = await applyEmployeeVisibility(qb, userId);
  qb = applyEmployeeFilters(qb, { entityType, entityId, search, department, isActive });

  const total = await qb.getCount();
  const employees = await qb
    .orderBy('e.name', 'ASC')
    .skip(offset)
    .take(limit)
    .getMany();

  return {
    employees: await resolveEntityNames(employees),
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

  const employeeRepo = repo('Employee');
  try {
    const employee = employeeRepo.create({
      entity_type: entityType,
      entity_id: entityId,
      employee_code: employeeCode?.trim() || null,
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      department: department?.trim() || null,
      job_title: jobTitle?.trim() || null,
      is_active: isActive !== false,
      created_by: userId,
    });
    const saved = await employeeRepo.save(employee);
    return getEmployeeById(saved.id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw Object.assign(new Error('An employee with this email already exists for this entity'), { status: 409 });
    }
    throw err;
  }
}

async function updateEmployee(userId, id, data) {
  const existing = await assertCanAccessEmployee(userId, await getEmployeeById(id));

  const allowed = {
    employee_code: 'employee_code',
    name: 'name',
    email: 'email',
    phone: 'phone',
    department: 'department',
    job_title: 'job_title',
    is_active: 'is_active',
  };

  const updates = {};
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
      updates[col] = val;
    }
  }

  if (!Object.keys(updates).length) return existing;

  try {
    await repo('Employee').update(id, updates);
    return getEmployeeById(id);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw Object.assign(new Error('An employee with this email already exists for this entity'), { status: 409 });
    }
    throw err;
  }
}

async function deleteEmployee(userId, id) {
  await assertCanAccessEmployee(userId, await getEmployeeById(id));
  await repo('Employee').delete(id);
  return { deleted: true };
}

async function insertEmployeeRow({ entityType, entityId, createdBy, row }) {
  const employeeRepo = repo('Employee');
  const saved = await employeeRepo.save({
    entity_type: entityType,
    entity_id: entityId,
    employee_code: row.employeeCode || null,
    name: row.name,
    email: row.email || null,
    phone: row.phone || null,
    department: row.department || null,
    job_title: row.jobTitle || null,
    created_by: createdBy,
  });
  return saved.id;
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
