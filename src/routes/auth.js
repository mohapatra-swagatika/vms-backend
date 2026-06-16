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

function resolveClient(body = {}, headerClient) {
  const fromBody = typeof body.client === 'string' ? body.client.trim().toLowerCase() : '';
  const fromHeader = typeof headerClient === 'string' ? headerClient.trim().toLowerCase() : '';
  return fromBody || fromHeader || 'admin';
}

function isMobileClient(client) {
  return client === 'mobile';
}

async function issueTokens(user) {
  const payload = { id: user.id, email: user.email, name: user.name };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });
  const assignments = (await findActiveAssignments(user.id)).map(formatAssignmentRow);
  const perms = await getAllPermissions(user.id);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone },
    permissions: perms.allowed,
    assignments,
  };
}

// POST /auth/login
// Body: { email, password, client?: 'admin' | 'mobile' }
// Header (optional): X-Client: admin | mobile
// Default client is 'admin' so existing admin portal behaviour is unchanged.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const client = resolveClient(req.body, req.headers['x-client']);

    const user = await repo('User').findOne({
      where: { email: email.toLowerCase(), is_active: true },
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    if (!isMobileClient(client)) {
      const maxLevel = await getMaxAssignmentLevel(user.id);
      if (maxLevel < MIN_ADMIN_PORTAL_LEVEL) {
        return res.status(403).json({ error: ADMIN_PORTAL_DENIED });
      }
    }

    return res.json(await issueTokens(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/refresh
// Body: { refresh_token, client?: 'admin' | 'mobile' }
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'Refresh token required' });

    const client = resolveClient(req.body, req.headers['x-client']);
    const payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

    if (!isMobileClient(client)) {
      const maxLevel = await getMaxAssignmentLevel(payload.id);
      if (maxLevel < MIN_ADMIN_PORTAL_LEVEL) {
        return res.status(403).json({ error: ADMIN_PORTAL_DENIED });
      }
    }

    const accessToken = jwt.sign(
      { id: payload.id, email: payload.email, name: payload.name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    res.json({ access_token: accessToken });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
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
