const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { repo } = require('../db');
const {
  findActiveAssignments,
  formatAssignmentRow,
} = require('../db/queries/assignments');
const { getAllPermissions } = require('../services/permissions');
const { getMaxAssignmentLevel, MIN_ADMIN_PORTAL_LEVEL } = require('../services/userScope');

const ADMIN_PORTAL_DENIED = 'Your account does not have access to the admin portal.';

const USER_SESSION_FIELDS = {
  id: true,
  email: true,
  name: true,
  phone: true,
  is_active: true,
};

function resolveClient(body = {}, headerClient) {
  const fromBody = typeof body.client === 'string' ? body.client.trim().toLowerCase() : '';
  const fromHeader = typeof headerClient === 'string' ? headerClient.trim().toLowerCase() : '';
  return fromBody || fromHeader || 'admin';
}

function isMobileClient(client) {
  return client === 'mobile';
}

function signAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });
}

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone ?? null,
  };
}

async function assertClientAccess(userId, client) {
  if (isMobileClient(client)) {
    return { ok: true };
  }

  const maxLevel = await getMaxAssignmentLevel(userId);
  if (maxLevel < MIN_ADMIN_PORTAL_LEVEL) {
    return { ok: false, status: 403, error: ADMIN_PORTAL_DENIED };
  }
  return { ok: true };
}

async function loadActiveUser(userId) {
  return repo('User').findOne({
    where: { id: userId, is_active: true },
    select: USER_SESSION_FIELDS,
  });
}

async function issueTokens(user) {
  const payload = { id: user.id, email: user.email, name: user.name };
  const assignments = (await findActiveAssignments(user.id)).map(formatAssignmentRow);
  const perms = await getAllPermissions(user.id);

  return {
    access_token: signAccessToken(payload),
    refresh_token: signRefreshToken(payload),
    user: toPublicUser(user),
    permissions: perms.allowed,
    assignments,
  };
}

async function issueRefreshedTokens(user, { rotateRefresh = true } = {}) {
  const payload = { id: user.id, email: user.email, name: user.name };
  const response = {
    access_token: signAccessToken(payload),
    user: toPublicUser(user),
  };

  if (rotateRefresh) {
    response.refresh_token = signRefreshToken(payload);
  }

  return response;
}

// POST /auth/login
// Body: { email, password, client?: 'admin' | 'mobile' }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const client = resolveClient(req.body, req.headers['x-client']);

    const user = await repo('User').findOne({
      where: { email: email.toLowerCase(), is_active: true },
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const access = await assertClientAccess(user.id, client);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    return res.json(await issueTokens(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/refresh
// Body: { refresh_token, client?: 'admin' | 'mobile' }
// Returns a new access token; rotates refresh token by default.
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'Refresh token required' });

    const client = resolveClient(req.body, req.headers['x-client']);
    const payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

    const user = await loadActiveUser(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    const access = await assertClientAccess(user.id, client);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    return res.json(await issueRefreshedTokens(user));
  } catch {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// GET /auth/permissions
router.get('/permissions', require('../middleware/auth'), async (req, res) => {
  try {
    const perms = await getAllPermissions(req.user.id);
    res.json(perms);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load permissions' });
  }
});

module.exports = router;
