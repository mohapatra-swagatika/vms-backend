const pool  = require('../db/pool');
const TTL   = 300; // 5 minutes

// Optional Redis — gracefully skip if not available
let redis = null;
try {
  const Redis = require('ioredis');
  const client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
  });
  client.on('error', () => { /* silence — handled below */ });
  redis = client;
} catch (_) { /* ioredis not installed or unavailable */ }

async function cacheGet(key) {
  try { return redis ? await redis.get(key) : null; } catch (_) { return null; }
}
async function cacheSet(key, ttl, value) {
  try { if (redis) await redis.setex(key, ttl, value); } catch (_) { /* no-op */ }
}
async function cacheDel(pattern) {
  try {
    if (!redis) return;
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  } catch (_) { /* no-op */ }
}

async function getEffectivePermissions(userId, scopeType, scopeId) {
  const cacheKey = `perm:${userId}:${scopeType}:${scopeId || 'global'}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached);

  const { rows } = await pool.query(`
    SELECT r.permissions
    FROM   user_role_assignments ura
    JOIN   roles r ON r.id = ura.role_id
    WHERE  ura.user_id = $1
      AND (
            ura.scope_type = 'global'
         OR (ura.scope_type = $2 AND ura.scope_id = $3)
         OR (ura.scope_type = 'tower' AND $2 = 'company' AND ura.scope_id = (
               SELECT tower_id FROM companies WHERE id = $3
             ))
         OR (ura.scope_type = 'organization' AND $2 = 'location' AND ura.scope_id = (
               SELECT organization_id FROM locations WHERE id = $3
             ))
      )
      AND (ura.expires_at IS NULL OR ura.expires_at > now())
  `, [userId, scopeType || 'global', scopeId || null]);

  const allowed = new Set();
  const denied  = new Set();

  for (const row of rows) {
    const { actions = [], not_actions = [] } = row.permissions;
    actions.forEach(a => allowed.add(a));
    not_actions.forEach(a => denied.add(a));
  }

  denied.forEach(a => allowed.delete(a));

  const result = { allowed: [...allowed], denied: [...denied] };
  await cacheSet(cacheKey, TTL, JSON.stringify(result));
  return result;
}

// Returns union of all permissions across every role assignment the user has,
// regardless of scope. Used at login time for dashboard display.
async function getAllPermissions(userId) {
  const cacheKey = `perm:${userId}:all`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached);

  const { rows } = await pool.query(`
    SELECT r.permissions
    FROM   user_role_assignments ura
    JOIN   roles r ON r.id = ura.role_id
    WHERE  ura.user_id = $1
      AND  (ura.expires_at IS NULL OR ura.expires_at > now())
  `, [userId]);

  const allowed = new Set();
  const denied  = new Set();

  for (const row of rows) {
    const { actions = [], not_actions = [] } = row.permissions;
    actions.forEach(a => allowed.add(a));
    not_actions.forEach(a => denied.add(a));
  }

  denied.forEach(a => allowed.delete(a));

  const result = { allowed: [...allowed], denied: [...denied] };
  await cacheSet(cacheKey, TTL, JSON.stringify(result));
  return result;
}

async function invalidateCache(userId) {
  await cacheDel(`perm:${userId}:*`);
}

module.exports = { getEffectivePermissions, getAllPermissions, invalidateCache, redis };
