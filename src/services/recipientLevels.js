/**
 * Notification recipient tiers by role level (dynamic RBAC).
 * Custom roles are grouped by numeric level — not by role name.
 * Override via env without code changes.
 */

function readLevel(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function getRecipientLevelBands() {
  return {
    gate: {
      min: readLevel('NOTIFY_GATE_LEVEL_MIN', 100),
      max: readLevel('NOTIFY_GATE_LEVEL_MAX', 199),
    },
    front_desk: {
      min: readLevel('NOTIFY_FD_LEVEL_MIN', 200),
      max: readLevel('NOTIFY_FD_LEVEL_MAX', 399),
    },
    admin: {
      min: readLevel('NOTIFY_ADMIN_LEVEL_MIN', 400),
      max: readLevel('NOTIFY_ADMIN_LEVEL_MAX', 999),
    },
  };
}

module.exports = { getRecipientLevelBands };
