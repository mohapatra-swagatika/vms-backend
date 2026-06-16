const { repo } = require('../db');

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
  const roles = await repo('Role').find({ select: { permissions: true } });
  const all = new Set(PERMISSION_CATALOG);

  for (const role of roles) {
    const { actions = [], not_actions = [] } = role.permissions || {};
    actions.forEach((perm) => all.add(perm));
    not_actions.forEach((perm) => all.add(perm));
  }

  return [...all].sort();
}

module.exports = { PERMISSION_CATALOG, getPermissionCatalog };
