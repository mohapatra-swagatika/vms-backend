const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { repo } = require('../db');
const {
  findActiveAssignments,
  formatAssignmentRow,
} = require('../db/queries/assignments');
const { getEffectivePermissions, getAllPermissions } = require('../services/permissions');
const { getMaxAssignmentLevel, MIN_ADMIN_PORTAL_LEVEL } = require('../services/userScope');

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const user = await repo('User').findOne({
      where: { email: email.toLowerCase(), is_active: true },
    });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const payload = { id: user.id, email: user.email, name: user.name };
    const accessToken  = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });

    const assignments = (await findActiveAssignments(user.id)).map(formatAssignmentRow);

    const maxLevel = await getMaxAssignmentLevel(user.id);
    if (maxLevel < MIN_ADMIN_PORTAL_LEVEL) {
      return res.status(403).json({
        error: 'Your account does not have access to the admin portal.',
      });
    }

    const perms = await getAllPermissions(user.id);

    return res.json({
      access_token:  accessToken,
      refresh_token: refreshToken,
      user:          { id: user.id, email: user.email, name: user.name, phone: user.phone },
      permissions:   perms.allowed,
      assignments,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'Refresh token required' });
    const payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

    const maxLevel = await getMaxAssignmentLevel(payload.id);
    if (maxLevel < MIN_ADMIN_PORTAL_LEVEL) {
      return res.status(403).json({
        error: 'Your account does not have access to the admin portal.',
      });
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
