const {
  mergePermissionRows,
  fetchScopedPermissions,
  fetchAllActivePermissions,
} = require('../db/queries/assignments');

const TTL = 300; // 5 minutes

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
  const cached = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached);

  const rows = await fetchScopedPermissions(userId, scopeType, scopeId);
  const result = mergePermissionRows(rows);
  await cacheSet(cacheKey, TTL, JSON.stringify(result));
  return result;
}

async function getAllPermissions(userId) {
  const cacheKey = `perm:${userId}:all`;
  const cached = await cacheGet(cacheKey);
  if (cached) return JSON.parse(cached);

  const rows = await fetchAllActivePermissions(userId);
  const result = mergePermissionRows(rows);
  await cacheSet(cacheKey, TTL, JSON.stringify(result));
  return result;
}

async function invalidateCache(userId) {
  await cacheDel(`perm:${userId}:*`);
}

module.exports = { getEffectivePermissions, getAllPermissions, invalidateCache, redis };
