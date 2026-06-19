const router = require('express').Router();
const { uploadVisitorPhoto } = require('../middleware/upload');
const mobileAuth = require('../middleware/mobileAuth');
const { can } = require('../middleware/rbac');
const {
  listVisitors,
  getVisitorById,
  createVisitor,
  updateVisitor,
  checkInVisitor,
  checkOutVisitor,
  assertCanAccessVisitor,
  resolveVisitor,
} = require('../services/visitors');

router.use(mobileAuth);

function sendServiceError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Request failed' });
}

router.get('/', can('visitor:read'), async (req, res) => {
  try {
    const result = await listVisitors(req.user.id, req.query);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err);
  }
});

router.get('/:id', can('visitor:read'), async (req, res) => {
  try {
    const visitor = await resolveVisitor(
      await assertCanAccessVisitor(
        req.user.id,
        await getVisitorById(req.params.id),
      ),
    );
    res.json({ visitor });
  } catch (err) {
    sendServiceError(res, err);
  }
});

router.post('/', can('visitor:create'), uploadVisitorPhoto, async (req, res) => {
  try {
    const visitor = await createVisitor(req.user.id, req.body, req.file);
    res.status(201).json({ visitor });
  } catch (err) {
    sendServiceError(res, err);
  }
});

router.patch('/:id', can('visitor:update'), async (req, res) => {
  try {
    const visitor = await updateVisitor(req.user.id, req.params.id, req.body);
    res.json({ visitor });
  } catch (err) {
    sendServiceError(res, err);
  }
});

router.post('/:id/checkin', can('visit_request:checkin'), async (req, res) => {
  try {
    const visitor = await checkInVisitor(req.user.id, req.params.id);
    res.json({ visitor });
  } catch (err) {
    sendServiceError(res, err);
  }
});

router.post('/:id/checkout', can('visit_request:checkout'), async (req, res) => {
  try {
    const visitor = await checkOutVisitor(req.user.id, req.params.id);
    res.json({ visitor });
  } catch (err) {
    sendServiceError(res, err);
  }
});

module.exports = router;
