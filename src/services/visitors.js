const { repo } = require('../db');
const { getUserTopScope, isGlobalScope } = require('./userScope');
const { canAccessEntity } = require('./entityAccess');
const {
  applyScopeVisibilityToScopedEntityQb,
  resolveEntityNames,
} = require('../db/queries/assignments');
const { uploadBuffer, visitorPhotoKey, resolveImageUrl } = require('./storage');
const { optimizeImage } = require('./imageOptimize');

const ENTITY_TYPES = ['tower', 'company', 'organization', 'location'];

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function visitorQb() {
  return repo('Visitor').createQueryBuilder('v');
}

async function applyVisitorVisibility(qb, userId) {
  const scope = await getUserTopScope(userId);
  if (isGlobalScope(scope)) return qb;
  return applyScopeVisibilityToScopedEntityQb(qb, scope, 'v');
}

function applyVisitorSearch(qb, search) {
  if (!search) return qb;
  return qb.andWhere(`(
    v.name ILIKE :search
    OR COALESCE(v.email, '') ILIKE :search
    OR COALESCE(v.phone, '') ILIKE :search
    OR COALESCE(v.host_name, '') ILIKE :search
  )`, { search: `%${search}%` });
}

async function resolveEntityForCreate(userId, body = {}) {
  const { entity_type: entityType, entity_id: entityId } = body;
  if (entityType && entityId) {
    if (!ENTITY_TYPES.includes(entityType)) {
      throw Object.assign(new Error('Invalid entity type'), { status: 400 });
    }
    const allowed = await canAccessEntity(userId, entityType, entityId);
    if (!allowed) {
      throw Object.assign(new Error('You do not have access to this entity'), { status: 403 });
    }
    return { entityType, entityId };
  }

  const scope = await getUserTopScope(userId);
  if (!scope?.scope_type || !scope.scope_id || scope.scope_type === 'global') {
    throw Object.assign(
      new Error('entity_type and entity_id are required for your account'),
      { status: 400 },
    );
  }

  return { entityType: scope.scope_type, entityId: scope.scope_id };
}

async function resolveVisitor(visitor) {
  if (!visitor?.photo_url) return visitor;
  return { ...visitor, photo_url: await resolveImageUrl(visitor.photo_url) };
}

async function resolveVisitors(visitors) {
  return Promise.all((visitors || []).map(resolveVisitor));
}

async function getVisitorById(id) {
  const visitor = await repo('Visitor').findOne({ where: { id } });
  if (!visitor) return null;
  const [withName] = await resolveEntityNames([visitor]);
  return withName;
}

async function assertCanAccessVisitor(userId, visitor) {
  if (!visitor) {
    throw Object.assign(new Error('Visitor not found'), { status: 404 });
  }
  const allowed = await canAccessEntity(userId, visitor.entity_type, visitor.entity_id);
  if (!allowed) {
    throw Object.assign(new Error('You do not have access to this visitor'), { status: 403 });
  }
  return visitor;
}

async function listVisitors(userId, query = {}) {
  const page = Math.max(1, parsePositiveInt(query.page, 1));
  const limit = Math.min(100, Math.max(1, parsePositiveInt(query.limit, 20)));
  const offset = (page - 1) * limit;
  const search = typeof query.search === 'string' ? query.search.trim() : '';

  let qb = visitorQb();
  qb = await applyVisitorVisibility(qb, userId);
  qb = applyVisitorSearch(qb, search);

  const total = await qb.getCount();
  const visitors = await qb
    .orderBy('v.created_at', 'DESC')
    .skip(offset)
    .take(limit)
    .getMany();

  return {
    visitors: await resolveVisitors(await resolveEntityNames(visitors)),
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit) || 0,
    },
  };
}

async function createVisitor(userId, body = {}, file = null) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    throw Object.assign(new Error('Visitor name is required'), { status: 400 });
  }

  const { entityType, entityId } = await resolveEntityForCreate(userId, body);

  const visitorRepo = repo('Visitor');
  let visitor = await visitorRepo.save(visitorRepo.create({
    entity_type: entityType,
    entity_id: entityId,
    name,
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    purpose: body.purpose?.trim() || null,
    host_name: body.host_name?.trim() || null,
    host_email: body.host_email?.trim() || null,
    organization: body.organization?.trim() || null,
    department: body.department?.trim() || null,
    status: 'pending',
    created_by: userId,
  }));

  if (file?.buffer) {
    const { buffer, contentType, ext } = await optimizeImage(file.buffer, file.mimetype);
    const key = visitorPhotoKey(visitor.id, `upload${ext}`);
    const storageRef = await uploadBuffer({ key, buffer, contentType });
    await visitorRepo.update(visitor.id, { photo_url: storageRef });
    visitor = await repo('Visitor').findOne({ where: { id: visitor.id } });
  }

  return resolveVisitor(visitor);
}

async function updateVisitor(userId, id, body = {}) {
  await assertCanAccessVisitor(userId, await getVisitorById(id));

  const updatable = [
    'name', 'email', 'phone', 'purpose', 'host_name', 'host_email',
    'organization', 'department', 'status',
  ];

  const updates = {};
  for (const key of updatable) {
    if (body[key] !== undefined) {
      const value = typeof body[key] === 'string' ? body[key].trim() : body[key];
      updates[key] = value || null;
    }
  }

  if (!Object.keys(updates).length) {
    return resolveVisitor(await getVisitorById(id));
  }

  await repo('Visitor').update(id, updates);
  return resolveVisitor(await getVisitorById(id));
}

async function checkInVisitor(userId, id) {
  const visitor = await assertCanAccessVisitor(userId, await getVisitorById(id));
  if (visitor.status === 'checked_out') {
    throw Object.assign(new Error('Visitor has already checked out'), { status: 400 });
  }

  const updates = { status: 'checked_in' };
  if (!visitor.check_in_at) {
    updates.check_in_at = new Date();
  }
  await repo('Visitor').update(id, updates);
  return resolveVisitor(await getVisitorById(id));
}

async function checkOutVisitor(userId, id) {
  await assertCanAccessVisitor(userId, await getVisitorById(id));

  await repo('Visitor').update(id, {
    status: 'checked_out',
    check_out_at: new Date(),
  });
  return resolveVisitor(await getVisitorById(id));
}

module.exports = {
  resolveVisitor,
  listVisitors,
  getVisitorById,
  createVisitor,
  updateVisitor,
  checkInVisitor,
  checkOutVisitor,
  assertCanAccessVisitor,
};
