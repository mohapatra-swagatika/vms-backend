const router = require('express').Router();
const { repo, repoByTable } = require('../db');
const auth   = require('../middleware/auth');
const { canUploadEntityImage } = require('../middleware/entityImage');
const { canUploadEmployeeCsv } = require('../middleware/employee');
const { uploadEntityImage, uploadEmployeeCsv } = require('../middleware/upload');
const { CSV_TEMPLATE, importEmployeesFromCsv } = require('../services/employeeCsv');
const {
  getEntityGallery,
  insertEntityImages,
  resolveImageRow,
  resolveImageRows,
} = require('../services/entityImages');
const {
  listTowers,
  listOrganizations,
  listCompanies,
  listLocations,
} = require('../services/entityList');
const { getUserTopScope, isGlobalScope } = require('../services/userScope');
const { canAccessEntity } = require('../services/entityAccess');
const { can } = require('../middleware/rbac');
const {
  normalizeEntityConfig,
  validateEntityConfigPatch,
  mergeEntityConfig,
  sanitizeEntityConfig,
} = require('../services/entityConfig');
const { getNotificationRecipients } = require('../services/notificationRecipients');
const { TABLE_BY_TYPE, getParentEntity } = require('../services/entityHierarchy');

const CONFIG_ENTITY = {
  towers:         { table: 'towers',         entityType: 'tower' },
  organizations:  { table: 'organizations',  entityType: 'organization' },
  companies:      { table: 'companies',      entityType: 'company' },
  locations:      { table: 'locations',      entityType: 'location' },
};

async function loadParentConfigPayload(entityType, entityId) {
  const parentRef = await getParentEntity(entityType, entityId);
  if (!parentRef) return null;

  const parentTable = TABLE_BY_TYPE[parentRef.type];
  if (!parentTable) return null;

  const row = await repoByTable(parentTable).findOne({
    where: { id: parentRef.id },
    select: { id: true, name: true, notify_channels: true },
  });
  if (!row) return null;

  const recipients = await getNotificationRecipients(parentRef.type, parentRef.id);
  return {
    entity_type: parentRef.type,
    entity_id: parentRef.id,
    entity_name: row.name,
    config: sanitizeEntityConfig(row.notify_channels, recipients),
    recipients,
  };
}

async function buildConfigPayload(entityType, table, entityId) {
  const row = await repoByTable(table).findOne({
    where: { id: entityId },
    select: { id: true, name: true, notify_channels: true },
  });
  if (!row) return null;
  const recipients = await getNotificationRecipients(entityType, entityId);
  return {
    config: sanitizeEntityConfig(row.notify_channels, recipients),
    recipients,
    parent: await loadParentConfigPayload(entityType, entityId),
  };
}

function registerEntityConfigRoutes(segment) {
  const meta = CONFIG_ENTITY[segment];
  if (!meta) return;

  router.get(`/${segment}/:id/config`, can('settings:read'), async (req, res) => {
    try {
      if (!await canAccessEntity(req.user.id, meta.entityType, req.params.id))
        return res.status(403).json({ error: 'Access denied' });

      const payload = await buildConfigPayload(meta.entityType, meta.table, req.params.id);
      if (!payload) return res.status(404).json({ error: 'Entity not found' });
      res.json(payload);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load configuration' });
    }
  });

  router.patch(`/${segment}/:id/config`, can('settings:update'), async (req, res) => {
    try {
      if (!await canAccessEntity(req.user.id, meta.entityType, req.params.id))
        return res.status(403).json({ error: 'Access denied' });

      const patch = req.body?.config ?? req.body;
      const err = validateEntityConfigPatch(patch);
      if (err) return res.status(400).json(err);

      const existing = await repoByTable(meta.table).findOne({
        where: { id: req.params.id },
        select: { notify_channels: true },
      });
      if (!existing) return res.status(404).json({ error: 'Entity not found' });

      const recipients = await getNotificationRecipients(meta.entityType, req.params.id);
      const merged = mergeEntityConfig(existing.notify_channels, patch);
      const config = sanitizeEntityConfig(merged, recipients);

      await repoByTable(meta.table).update(req.params.id, {
        notify_channels: config,
      });
      res.json({ config, recipients });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update configuration' });
    }
  });
}

router.use(auth);

// ============ TOWERS ============

// GET /entities/towers  — scoped by role
router.get('/towers', async (req, res) => {
  try {
    const towers = await listTowers(req.user.id);
    res.json({ towers: await resolveImageRows(towers) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load towers' });
  }
});

// GET /entities/towers/:id
router.get('/towers/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'tower', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    const tower = await repo('Tower').findOne({ where: { id: req.params.id } });
    if (!tower) return res.status(404).json({ error: 'Tower not found' });
    const companies = await repo('Company').find({
      where: { tower_id: req.params.id },
      order: { created_at: 'DESC' },
    });
    res.json({
      tower: await resolveImageRow(tower),
      companies: await resolveImageRows(companies),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load tower' });
  }
});

// POST /entities/towers  — Support only
router.post('/towers', async (req, res) => {
  try {
    const scope = await getUserTopScope(req.user.id);
    if (!isGlobalScope(scope))
      return res.status(403).json({ error: 'Only Support users can create towers.' });

    const { name, address, image_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const towerRepo = repo('Tower');
    const saved = await towerRepo.save(towerRepo.create({
      name,
      address: address || null,
      image_url: image_url || null,
      created_by: req.user.id,
    }));
    res.status(201).json({ tower: await resolveImageRow(saved) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create tower' });
  }
});

// PATCH /entities/towers/:id
router.patch('/towers/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'tower', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    const { name, address, image_url, notify_channels } = req.body;
    if (notify_channels !== undefined) {
      const err = validateEntityConfigPatch(notify_channels);
      if (err) return res.status(400).json(err);
    }
    const towerRepo = repo('Tower');
    const existing = await towerRepo.findOne({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Tower not found' });

    const mergedConfig = notify_channels !== undefined
      ? mergeEntityConfig(existing.notify_channels, notify_channels)
      : null;

    if (name != null) existing.name = name;
    if (address != null) existing.address = address;
    if (image_url != null) existing.image_url = image_url;
    if (mergedConfig != null) existing.notify_channels = mergedConfig;

    const saved = await towerRepo.save(existing);
    res.json({ tower: await resolveImageRow(saved) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update tower' });
  }
});

// DELETE /entities/towers/:id  — Support only
router.delete('/towers/:id', async (req, res) => {
  try {
    const scope = await getUserTopScope(req.user.id);
    if (!isGlobalScope(scope))
      return res.status(403).json({ error: 'Only Support users can delete towers.' });

    await repo('Tower').delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete tower' });
  }
});

// ============ COMPANIES ============

// GET /entities/companies (?tower_id=...)  — scoped
router.get('/companies', async (req, res) => {
  try {
    const companies = await listCompanies(req.user.id, { towerId: req.query.tower_id });
    res.json({ companies: await resolveImageRows(companies) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load companies' });
  }
});

// POST /entities/companies
router.post('/companies', async (req, res) => {
  try {
    const { tower_id, name, address, image_url, approval_chain, notify_channels } = req.body;
    if (!tower_id || !name) return res.status(400).json({ error: 'tower_id and name are required' });

    const scope = await getUserTopScope(req.user.id);
    if (!isGlobalScope(scope)) {
      if (scope.scope_type === 'tower') {
        if (scope.scope_id !== tower_id)
          return res.status(403).json({ error: 'You can only add companies to your own tower.' });
      } else {
        return res.status(403).json({ error: 'You cannot create companies at your hierarchy level.' });
      }
    }

    const companyRepo = repo('Company');
    const saved = await companyRepo.save(companyRepo.create({
      tower_id,
      name,
      address: address || null,
      image_url: image_url || null,
      approval_chain: approval_chain || { bypass_enabled: false, steps: [] },
      notify_channels: notify_channels || { whatsapp: true, email: true, call: false, push: true },
      created_by: req.user.id,
    }));
    res.status(201).json({ company: await resolveImageRow(saved) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

// PATCH /entities/companies/:id
router.patch('/companies/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'company', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    const { name, address, image_url, approval_chain, notify_channels } = req.body;
    if (notify_channels !== undefined) {
      const err = validateEntityConfigPatch(notify_channels);
      if (err) return res.status(400).json(err);
    }
    const companyRepo = repo('Company');
    const existing = await companyRepo.findOne({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Company not found' });

    const mergedConfig = notify_channels !== undefined
      ? mergeEntityConfig(existing.notify_channels, notify_channels)
      : null;

    if (name != null) existing.name = name;
    if (address != null) existing.address = address;
    if (image_url != null) existing.image_url = image_url;
    if (approval_chain != null) existing.approval_chain = approval_chain;
    if (mergedConfig != null) existing.notify_channels = mergedConfig;

    const saved = await companyRepo.save(existing);
    const company = await resolveImageRow(saved);
    res.json({ company: { ...company, config: normalizeEntityConfig(saved.notify_channels) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

// DELETE /entities/companies/:id
router.delete('/companies/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'company', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    await repo('Company').delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete company' });
  }
});

// ============ ORGANIZATIONS ============

// GET /entities/organizations  — scoped
router.get('/organizations', async (req, res) => {
  try {
    const organizations = await listOrganizations(req.user.id);
    res.json({ organizations: await resolveImageRows(organizations) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load organizations' });
  }
});

router.get('/organizations/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'organization', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    const org = await repo('Organization').findOne({ where: { id: req.params.id } });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const locations = await repo('Location').find({
      where: { organization_id: req.params.id },
      order: { created_at: 'DESC' },
    });
    res.json({
      organization: await resolveImageRow(org),
      locations: await resolveImageRows(locations),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load organization' });
  }
});

// POST /entities/organizations  — Support only
router.post('/organizations', async (req, res) => {
  try {
    const scope = await getUserTopScope(req.user.id);
    if (!isGlobalScope(scope))
      return res.status(403).json({ error: 'Only Support users can create organizations.' });

    const { name, address, image_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const orgRepo = repo('Organization');
    const saved = await orgRepo.save(orgRepo.create({
      name,
      address: address || null,
      image_url: image_url || null,
      created_by: req.user.id,
    }));
    res.status(201).json({ organization: await resolveImageRow(saved) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

router.patch('/organizations/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'organization', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    const { name, address, image_url, notify_channels } = req.body;
    if (notify_channels !== undefined) {
      const err = validateEntityConfigPatch(notify_channels);
      if (err) return res.status(400).json(err);
    }
    const orgRepo = repo('Organization');
    const existing = await orgRepo.findOne({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Organization not found' });

    const mergedConfig = notify_channels !== undefined
      ? mergeEntityConfig(existing.notify_channels, notify_channels)
      : null;

    if (name != null) existing.name = name;
    if (address != null) existing.address = address;
    if (image_url != null) existing.image_url = image_url;
    if (mergedConfig != null) existing.notify_channels = mergedConfig;

    const saved = await orgRepo.save(existing);
    res.json({ organization: await resolveImageRow(saved) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// DELETE /entities/organizations/:id  — Support only
router.delete('/organizations/:id', async (req, res) => {
  try {
    const scope = await getUserTopScope(req.user.id);
    if (!isGlobalScope(scope))
      return res.status(403).json({ error: 'Only Support users can delete organizations.' });

    await repo('Organization').delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// ============ LOCATIONS ============

// GET /entities/locations (?organization_id=...)  — scoped
router.get('/locations', async (req, res) => {
  try {
    const locations = await listLocations(req.user.id, {
      organizationId: req.query.organization_id,
    });
    res.json({ locations: await resolveImageRows(locations) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load locations' });
  }
});

router.post('/locations', async (req, res) => {
  try {
    const { organization_id, name, address, image_url, approval_chain, notify_channels } = req.body;
    if (!organization_id || !name)
      return res.status(400).json({ error: 'organization_id and name are required' });

    const scope = await getUserTopScope(req.user.id);
    if (!isGlobalScope(scope)) {
      if (scope.scope_type === 'organization') {
        if (scope.scope_id !== organization_id)
          return res.status(403).json({ error: 'You can only add locations to your own organization.' });
      } else {
        return res.status(403).json({ error: 'You cannot create locations at your hierarchy level.' });
      }
    }

    const locationRepo = repo('Location');
    const saved = await locationRepo.save(locationRepo.create({
      organization_id,
      name,
      address: address || null,
      image_url: image_url || null,
      approval_chain: approval_chain || { bypass_enabled: false, steps: [] },
      notify_channels: notify_channels || { whatsapp: true, email: true, call: false, push: true },
      created_by: req.user.id,
    }));
    res.status(201).json({ location: await resolveImageRow(saved) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

router.patch('/locations/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'location', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    const { name, address, image_url, approval_chain, notify_channels } = req.body;
    if (notify_channels !== undefined) {
      const err = validateEntityConfigPatch(notify_channels);
      if (err) return res.status(400).json(err);
    }
    const locationRepo = repo('Location');
    const existing = await locationRepo.findOne({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Location not found' });

    const mergedConfig = notify_channels !== undefined
      ? mergeEntityConfig(existing.notify_channels, notify_channels)
      : null;

    if (name != null) existing.name = name;
    if (address != null) existing.address = address;
    if (image_url != null) existing.image_url = image_url;
    if (approval_chain != null) existing.approval_chain = approval_chain;
    if (mergedConfig != null) existing.notify_channels = mergedConfig;

    const saved = await locationRepo.save(existing);
    const location = await resolveImageRow(saved);
    res.json({ location: { ...location, config: normalizeEntityConfig(saved.notify_channels) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.delete('/locations/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'location', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    await repo('Location').delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// ── Entity image gallery (multiple images per entity) ─────────────────────────
function entityImagesListHandler(entityType) {
  return async (req, res) => {
    try {
      if (!await canAccessEntity(req.user.id, entityType, req.params.id))
        return res.status(403).json({ error: 'Access denied' });
      const gallery = await getEntityGallery(entityType, req.params.id);
      res.json(gallery);
    } catch (err) {
      console.error(err);
      if (err.code === '42P01') {
        return res.status(500).json({ error: 'Image storage not ready. Run database migrations.' });
      }
      res.status(500).json({ error: 'Failed to load entity images' });
    }
  };
}

router.get('/towers/:id/images',         entityImagesListHandler('tower'));
router.get('/companies/:id/images',      entityImagesListHandler('company'));
router.get('/organizations/:id/images', entityImagesListHandler('organization'));
router.get('/locations/:id/images',      entityImagesListHandler('location'));

// ── Entity image uploads (image:upload_child) — append only; never replace prior uploads ───
function entityImageHandler(entityType, table, responseKey) {
  return async (req, res) => {
    try {
      const files = req.files?.length ? req.files : (req.file ? [req.file] : []);
      if (!files.length) return res.status(400).json({ error: 'No image files provided' });

      const existing = await repoByTable(table).findOne({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ error: 'Entity not found' });

      const imageUrls = await insertEntityImages(entityType, req.params.id, files, req.user.id);
      const latestUrl = imageUrls[imageUrls.length - 1];

      const total = await repo('EntityImage').count({
        where: { entity_type: entityType, entity_id: req.params.id },
      });

      res.json({
        image_url: latestUrl,
        image_urls: imageUrls,
        uploaded_count: imageUrls.length,
        total_images: total,
      });
    } catch (err) {
      console.error(err);
      if (err.code === '42P01') {
        return res.status(500).json({ error: 'Image storage not ready. Run database migrations.' });
      }
      res.status(500).json({ error: err.message || 'Failed to upload image' });
    }
  };
}

function entityImageRoute(path, entityType, table, responseKey) {
  router.post(path, canUploadEntityImage(entityType), uploadEntityImage, entityImageHandler(entityType, table, responseKey));
}

entityImageRoute('/towers/:id/image',         'tower',        'towers',         'tower');
entityImageRoute('/companies/:id/image',      'company',      'companies',      'company');
entityImageRoute('/organizations/:id/image', 'organization', 'organizations', 'organization');
entityImageRoute('/locations/:id/image',      'location',     'locations',      'location');

// ── Employee CSV import ────────────────────────────────────────────────────────
router.get('/employees/csv-template', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employee_import_template.csv"');
  res.send(CSV_TEMPLATE);
});

function employeeCsvHandler(entityType, table) {
  return async (req, res) => {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'No CSV file provided' });

      const existing = await repoByTable(table).findOne({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!existing) return res.status(404).json({ error: 'Entity not found' });

      const csvText = req.file.buffer.toString('utf8');
      const result = await importEmployeesFromCsv({
        csvText,
        entityType,
        entityId: req.params.id,
        createdBy: req.user.id,
      });

      const status = result.created_count > 0 ? 200 : 400;
      res.status(status).json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Failed to import employees' });
    }
  };
}

function employeeCsvRoute(path, entityType, table) {
  router.post(path, canUploadEmployeeCsv(entityType), uploadEmployeeCsv, employeeCsvHandler(entityType, table));
}

employeeCsvRoute('/towers/:id/employees/csv',         'tower',        'towers');
employeeCsvRoute('/companies/:id/employees/csv',      'company',      'companies');
employeeCsvRoute('/organizations/:id/employees/csv', 'organization', 'organizations');
employeeCsvRoute('/locations/:id/employees/csv',      'location',     'locations');

registerEntityConfigRoutes('towers');
registerEntityConfigRoutes('organizations');
registerEntityConfigRoutes('companies');
registerEntityConfigRoutes('locations');

module.exports = router;
