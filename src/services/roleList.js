const pool = require('../db/pool');
const { parsePagination, paginationMeta } = require('./pagination');

async function listRoles(query = {}) {
  const { page, limit, offset } = parsePagination(query);
  const search = (query.search || '').trim();
  const { is_system: isSystemRaw } = query;

  const conditions = [];
  const params = [];
  let idx = 1;

  if (search) {
    conditions.push(`(r.display_name ILIKE $${idx} OR r.name ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx += 1;
  }

  if (isSystemRaw === 'true' || isSystemRaw === true) {
    conditions.push('r.is_system = true');
  } else if (isSystemRaw === 'false' || isSystemRaw === false) {
    conditions.push('r.is_system = false');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM roles r ${where}`,
    params
  );
  const total = countRows[0]?.total ?? 0;

  const { rows } = await pool.query(`
    SELECT r.*,
      COUNT(ura.id)::int AS user_count
    FROM roles r
    LEFT JOIN user_role_assignments ura ON ura.role_id = r.id
      AND (ura.expires_at IS NULL OR ura.expires_at > now())
    ${where}
    GROUP BY r.id
    ORDER BY r.level DESC, r.display_name ASC
    LIMIT $${idx} OFFSET $${idx + 1}
  `, [...params, limit, offset]);

  return {
    roles: rows,
    pagination: paginationMeta(page, limit, total),
  };
}

module.exports = { listRoles };
