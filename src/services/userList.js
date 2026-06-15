const pool = require('../db/pool');
const { resolveProfiles } = require('./storage');
const { parsePagination, paginationMeta } = require('./pagination');

/** Resolve which user IDs the requester may see (null = no restriction). */
async function resolveVisibleUserIds(requesterId) {
  const { rows: myRoles } = await pool.query(`
    SELECT ura.scope_type, ura.scope_id, r.level, r.entity_type
    FROM   user_role_assignments ura
    JOIN   roles r ON r.id = ura.role_id
    WHERE  ura.user_id = $1
      AND  (ura.expires_at IS NULL OR ura.expires_at > now())
    ORDER  BY r.level DESC
    LIMIT  1
  `, [requesterId]);

  const top = myRoles[0];
  const isGlobal = !top || top.level >= 1000 || top.scope_type === 'global';

  if (isGlobal) return { isGlobal: true, allowedIds: null };

  if (!top.scope_id) {
    return { isGlobal: false, allowedIds: [requesterId] };
  }

  let visibleRows;

  if (top.scope_type === 'tower') {
    ({ rows: visibleRows } = await pool.query(`
      SELECT DISTINCT ura.user_id
      FROM   user_role_assignments ura
      WHERE  (ura.scope_type = 'tower'   AND ura.scope_id = $1)
         OR  (ura.scope_type = 'company' AND ura.scope_id IN (
               SELECT id FROM companies WHERE tower_id = $1
             ))
    `, [top.scope_id]));
  } else if (top.scope_type === 'organization') {
    ({ rows: visibleRows } = await pool.query(`
      SELECT DISTINCT ura.user_id
      FROM   user_role_assignments ura
      WHERE  (ura.scope_type = 'organization' AND ura.scope_id = $1)
         OR  (ura.scope_type = 'location'     AND ura.scope_id IN (
               SELECT id FROM locations WHERE organization_id = $1
             ))
    `, [top.scope_id]));
  } else if (top.scope_type === 'company') {
    ({ rows: visibleRows } = await pool.query(`
      SELECT DISTINCT ura.user_id
      FROM   user_role_assignments ura
      WHERE  ura.scope_type = 'company' AND ura.scope_id = $1
    `, [top.scope_id]));
  } else if (top.scope_type === 'location') {
    ({ rows: visibleRows } = await pool.query(`
      SELECT DISTINCT ura.user_id
      FROM   user_role_assignments ura
      WHERE  ura.scope_type = 'location' AND ura.scope_id = $1
    `, [top.scope_id]));
  } else {
    return { isGlobal: true, allowedIds: null };
  }

  const allowedIds = visibleRows.map(r => r.user_id);
  if (!allowedIds.includes(requesterId)) allowedIds.push(requesterId);
  return { isGlobal: false, allowedIds };
}

async function listUsers(requesterId, query = {}) {
  const { page, limit, offset } = parsePagination(query);
  const { search, role, is_active: isActiveRaw } = query;

  const { isGlobal, allowedIds } = await resolveVisibleUserIds(requesterId);

  const conditions = [];
  const params = [];
  let idx = 1;

  if (!isGlobal && allowedIds !== null) {
    conditions.push(`u.id = ANY($${idx}::uuid[])`);
    params.push(allowedIds);
    idx += 1;
  }

  if (search) {
    conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx += 1;
  }

  if (isActiveRaw === 'true' || isActiveRaw === true) {
    conditions.push('u.is_active = true');
  } else if (isActiveRaw === 'false' || isActiveRaw === false) {
    conditions.push('u.is_active = false');
  }

  if (role) {
    conditions.push(`EXISTS (
      SELECT 1 FROM user_role_assignments ura_f
      JOIN roles r_f ON r_f.id = ura_f.role_id
      WHERE ura_f.user_id = u.id
        AND (ura_f.expires_at IS NULL OR ura_f.expires_at > now())
        AND (r_f.display_name = $${idx} OR r_f.name = $${idx})
    )`);
    params.push(role);
    idx += 1;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM users u ${where}`,
    params
  );
  const total = countRows[0]?.total ?? 0;

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
    ${where}
    GROUP  BY u.id
    ORDER  BY u.created_at DESC
    LIMIT  $${idx} OFFSET $${idx + 1}
  `, [...params, limit, offset]);

  return {
    users: await resolveProfiles(rows),
    pagination: paginationMeta(page, limit, total),
  };
}

module.exports = { listUsers, resolveVisibleUserIds };
