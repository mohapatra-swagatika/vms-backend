/** Per-entity admin configuration (stored in notify_channels JSONB). */

const DEFAULT_ENTITY_CONFIG = {
  whatsapp: true,
  email: true,
  call: false,
  push: true,
  notify_gate: false,
  notify_front_desk: true,
  notify_admin: true,
  gate_user_ids: [],
  front_desk_user_ids: [],
  request_timeout_minutes: 15,
};

const MIN_TIMEOUT_MINUTES = 1;
const MAX_TIMEOUT_MINUTES = 120;

const BOOL_KEYS = [
  'whatsapp', 'email', 'call', 'push',
  'notify_gate', 'notify_front_desk', 'notify_admin',
];

const ARRAY_KEYS = ['gate_user_ids', 'front_desk_user_ids'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string' && UUID_RE.test(id)))];
}

function normalizeEntityConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const config = { ...DEFAULT_ENTITY_CONFIG };

  for (const key of BOOL_KEYS) {
    if (typeof src[key] === 'boolean') config[key] = src[key];
  }

  for (const key of ARRAY_KEYS) {
    if (src[key] !== undefined) config[key] = normalizeIdList(src[key]);
  }

  const timeout = Number(src.request_timeout_minutes);
  if (Number.isFinite(timeout)) {
    config.request_timeout_minutes = Math.min(
      MAX_TIMEOUT_MINUTES,
      Math.max(MIN_TIMEOUT_MINUTES, Math.round(timeout)),
    );
  }

  return config;
}

function validateEntityConfigPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { error: 'Config must be a JSON object' };
  }

  const allowed = [...BOOL_KEYS, ...ARRAY_KEYS, 'request_timeout_minutes'];
  const unknown = Object.keys(patch).filter(k => !allowed.includes(k));
  if (unknown.length) {
    return { error: `Unknown config field(s): ${unknown.join(', ')}` };
  }

  for (const key of BOOL_KEYS) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') {
      return { error: `${key} must be a boolean` };
    }
  }

  for (const key of ARRAY_KEYS) {
    if (patch[key] !== undefined) {
      if (!Array.isArray(patch[key])) return { error: `${key} must be an array of user IDs` };
      const invalid = patch[key].filter(id => typeof id !== 'string' || !UUID_RE.test(id));
      if (invalid.length) return { error: `${key} contains invalid user ID(s)` };
    }
  }

  if (patch.request_timeout_minutes !== undefined) {
    const timeout = Number(patch.request_timeout_minutes);
    if (!Number.isFinite(timeout) || timeout < MIN_TIMEOUT_MINUTES || timeout > MAX_TIMEOUT_MINUTES) {
      return { error: `request_timeout_minutes must be between ${MIN_TIMEOUT_MINUTES} and ${MAX_TIMEOUT_MINUTES}` };
    }
  }

  return null;
}

function mergeEntityConfig(existing, patch) {
  const base = normalizeEntityConfig(existing);
  const next = { ...base };

  for (const key of BOOL_KEYS) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }

  for (const key of ARRAY_KEYS) {
    if (patch[key] !== undefined) next[key] = normalizeIdList(patch[key]);
  }

  if (patch.request_timeout_minutes !== undefined) {
    next.request_timeout_minutes = Math.round(Number(patch.request_timeout_minutes));
  }

  return normalizeEntityConfig(next);
}

function sanitizeEntityConfig(config, recipients) {
  const normalized = normalizeEntityConfig(config);
  if (!recipients) return normalized;

  const gateIds = recipients.gate?.map(u => u.id) || [];
  const fdIds = recipients.front_desk?.map(u => u.id) || [];

  return {
    ...normalized,
    gate_user_ids: filterValidUserIds(normalized.gate_user_ids, gateIds),
    front_desk_user_ids: filterValidUserIds(normalized.front_desk_user_ids, fdIds),
  };
}

function filterValidUserIds(ids, allowedIds) {
  if (!Array.isArray(ids)) return [];
  const allowed = new Set(allowedIds);
  return ids.filter(id => typeof id === 'string' && UUID_RE.test(id) && allowed.has(id));
}

module.exports = {
  DEFAULT_ENTITY_CONFIG,
  MIN_TIMEOUT_MINUTES,
  MAX_TIMEOUT_MINUTES,
  normalizeEntityConfig,
  validateEntityConfigPatch,
  mergeEntityConfig,
  sanitizeEntityConfig,
};
