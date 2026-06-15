const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');
const { getEffectivePermissions, getAllPermissions } = require('../services/permissions');

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true', [email.toLowerCase()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const payload = { id: user.id, email: user.email, name: user.name };
    const accessToken  = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN });

    // Load assignments + permissions
    const { rows: assignments } = await pool.query(`
      SELECT ura.id, ura.scope_type, ura.scope_id, ura.expires_at,
             r.name as role_name, r.display_name, r.level
      FROM   user_role_assignments ura
      JOIN   roles r ON r.id = ura.role_id
      WHERE  ura.user_id = $1
        AND  (ura.expires_at IS NULL OR ura.expires_at > now())
    `, [user.id]);

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
