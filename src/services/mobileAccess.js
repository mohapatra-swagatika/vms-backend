const MOBILE_PERMISSION_PREFIXES = ['visitor:', 'visit_request:', 'qr:'];

const MOBILE_PORTAL_DENIED =
  'Your account does not have access to the mobile app. Visitor or visit-request permissions are required.';

function hasMobilePortalAccess(allowedPermissions = []) {
  return allowedPermissions.some((perm) =>
    MOBILE_PERMISSION_PREFIXES.some((prefix) => perm.startsWith(prefix)),
  );
}

module.exports = {
  MOBILE_PORTAL_DENIED,
  hasMobilePortalAccess,
};
