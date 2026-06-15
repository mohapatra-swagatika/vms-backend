const jwt = require('jsonwebtoken');
const { getMaxAssignmentLevel, MIN_ADMIN_PORTAL_LEVEL } = require('../services/userScope');

const ADMIN_PORTAL_DENIED = 'Your account does not have access to the admin portal.';

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const maxLevel = await getMaxAssignmentLevel(payload.id);
    if (maxLevel < MIN_ADMIN_PORTAL_LEVEL) {
      return res.status(403).json({ error: ADMIN_PORTAL_DENIED });
    }
    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
};
