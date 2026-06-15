const pool = require('../db/pool');

/** Canonical permission strings used across the VMS API. */
const PERMISSION_CATALOG = [
  'audit_log:export',
  'audit_log:read',
  'employee:create',
  'employee:csv_upload_child',
  'employee:csv_upload_self',
  'employee:delete',
  'employee:read',
  'employee:update',
  'entity:create',
  'entity:delete',
  'entity:read',
  'entity:update',
  'image:upload_child',
  'image:upload_self',
  'notification:configure',
  'notification:send',
  'qr:generate',
  'qr:revoke',
  'qr:scan',
  'report:export',
  'report:view',
  'role:assign',
  'role:create',
  'role:delete',
  'role:read',
  'role:update',
  'settings:read',
  'settings:update',
  'user:create',
  'user:delete',
  'user:impersonate',
  'user:read',
  'user:update',
  'visit_request:approve',
  'visit_request:checkin',
  'visit_request:checkout',
  'visit_request:create',
  'visit_request:more_info',
  'visit_request:read',
  'visit_request:reject',
  'visitor:create',
  'visitor:delete',
  'visitor:read',
  'visitor:update',
  'watchlist:create',
  'watchlist:delete',
  'watchlist:read',
  'watchlist:update',
];

/** Union of catalog + any permissions already stored on roles (custom roles). */
async function getPermissionCatalog() {
  const { rows } = await pool.query(`
    SELECT DISTINCT perm FROM (
      SELECT jsonb_array_elements_text(permissions->'actions') AS perm FROM roles
      UNION ALL
      SELECT jsonb_array_elements_text(permissions->'not_actions') AS perm FROM roles
    ) x
    WHERE perm IS NOT NULL AND perm <> ''
  `);

  const all = new Set([...PERMISSION_CATALOG, ...rows.map(r => r.perm)]);
  return [...all].sort();
}

module.exports = { PERMISSION_CATALOG, getPermissionCatalog };
