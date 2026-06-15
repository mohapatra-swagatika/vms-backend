const router = require('express').Router();
const auth = require('../middleware/auth');
const { can } = require('../middleware/rbac');
const {
  canReadEmployee,
  canUpdateEmployee,
  canDeleteEmployee,
} = require('../middleware/employee');
const {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  assertCanAccessEmployee,
} = require('../services/employees');

router.use(auth);

function sendServiceError(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Request failed' });
}

// GET /employees — scoped list with search, filters, pagination
router.get('/', can('employee:read'), async (req, res) => {
  try {
    const result = await listEmployees(req.user.id, req.query);
    res.json(result);
  } catch (err) {
    sendServiceError(res, err);
  }
});

// GET /employees/:id
router.get('/:id', canReadEmployee, async (req, res) => {
  try {
    const employee = await assertCanAccessEmployee(req.user.id, await getEmployeeById(req.params.id));
    res.json({ employee });
  } catch (err) {
    sendServiceError(res, err);
  }
});

// POST /employees
router.post('/', can('employee:create'), async (req, res) => {
  try {
    const employee = await createEmployee(req.user.id, req.body);
    res.status(201).json({ employee });
  } catch (err) {
    sendServiceError(res, err);
  }
});

// PATCH /employees/:id
router.patch('/:id', canUpdateEmployee, async (req, res) => {
  try {
    const employee = await updateEmployee(req.user.id, req.params.id, req.body);
    res.json({ employee });
  } catch (err) {
    sendServiceError(res, err);
  }
});

// DELETE /employees/:id
router.delete('/:id', canDeleteEmployee, async (req, res) => {
  try {
    await deleteEmployee(req.user.id, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    sendServiceError(res, err);
  }
});

module.exports = router;
