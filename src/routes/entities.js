const router = require('express').Router();
const pool   = require('../db/pool');
const auth   = require('../middleware/auth');
const { canUploadEntityImage } = require('../middleware/entityImage');
const { canUploadEmployeeCsv } = require('../middleware/employee');
const { uploadEntityImage, uploadEmployeeCsv } = require('../middleware/upload');
const { CSV_TEMPLATE, importEmployeesFromCsv } = require('../services/employeeCsv');
const {
  latestImageSql,
  getEntityGallery,
  insertEntityImages,
  resolveImageRow,
  resolveImageRows,
} = require('../services/entityImages');
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

const CONFIG_ENTITY = {
  towers:         { table: 'towers',         entityType: 'tower' },
  organizations:  { table: 'organizations',  entityType: 'organization' },
  companies:      { table: 'companies',      entityType: 'company' },
  locations:      { table: 'locations',      entityType: 'location' },
};

async function buildConfigPayload(entityType, table, entityId) {
  const { rows: [row] } = await pool.query(
    `SELECT id, name, notify_channels FROM ${table} WHERE id = $1`, [entityId],
  );
  if (!row) return null;
  const recipients = await getNotificationRecipients(entityType, entityId);
  return {
    config: sanitizeEntityConfig(row.notify_channels, recipients),
    recipients,
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

      const { rows: [existing] } = await pool.query(
        `SELECT notify_channels FROM ${meta.table} WHERE id = $1`, [req.params.id],
      );
      if (!existing) return res.status(404).json({ error: 'Entity not found' });

      const recipients = await getNotificationRecipients(meta.entityType, req.params.id);
      const merged = mergeEntityConfig(existing.notify_channels, patch);
      const config = sanitizeEntityConfig(merged, recipients);

      await pool.query(
        `UPDATE ${meta.table} SET notify_channels = $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify(config), req.params.id],
      );
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
    const scope = await getUserTopScope(req.user.id);
    let where = ''; let params = [];

    // Only global/support and tower-scoped users may list towers.
    // Company/org/location users must not see parent towers.
    if (!isGlobalScope(scope)) {
      if (scope.scope_type === 'tower' && scope.scope_id) {
        where = 'WHERE t.id = $1'; params = [scope.scope_id];
      } else {
        return res.json({ towers: [] });
      }
    }

    const countExpr = `(SELECT COUNT(*)::int FROM companies c WHERE c.tower_id = t.id)`;

    const { rows } = await pool.query(`
      SELECT t.id, t.name, t.address, t.notify_channels, t.created_by, t.created_at, t.updated_at,
        ${latestImageSql('tower', 't')} AS image_url,
        ${countExpr} AS company_count
      FROM towers t
      ${where}
      ORDER BY t.created_at DESC
    `, params);
    res.json({ towers: await resolveImageRows(rows) });
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

    const { rows: [tower] } = await pool.query('SELECT * FROM towers WHERE id = $1', [req.params.id]);
    if (!tower) return res.status(404).json({ error: 'Tower not found' });
    const { rows: companies } = await pool.query(
      'SELECT * FROM companies WHERE tower_id = $1 ORDER BY created_at DESC', [req.params.id]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO towers (name, address, image_url, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, address || null, image_url || null, req.user.id]
    );
    res.status(201).json({ tower: await resolveImageRow(rows[0]) });
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
    const { rows: [existing] } = await pool.query(
      'SELECT notify_channels FROM towers WHERE id = $1', [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: 'Tower not found' });

    const mergedConfig = notify_channels !== undefined
      ? mergeEntityConfig(existing.notify_channels, notify_channels)
      : null;

    const { rows } = await pool.query(
      `UPDATE towers SET
         name      = COALESCE($1, name),
         address   = COALESCE($2, address),
         image_url = COALESCE($3, image_url),
         notify_channels = COALESCE($4::jsonb, notify_channels),
         updated_at = now()
       WHERE id = $5 RETURNING *`,
      [name, address, image_url,
       mergedConfig ? JSON.stringify(mergedConfig) : null,
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Tower not found' });
    res.json({ tower: await resolveImageRow(rows[0]) });
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

    await pool.query('DELETE FROM towers WHERE id = $1', [req.params.id]);
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
    const scope = await getUserTopScope(req.user.id);
    const params = [];
    let where = '';

    if (req.query.tower_id) {
      params.push(req.query.tower_id);
      where = `WHERE c.tower_id = $${params.length}`;
    }

    if (!isGlobalScope(scope)) {
      if (scope.scope_type === 'tower' && scope.scope_id) {
        params.push(scope.scope_id);
        where = where
          ? `${where} AND c.tower_id = $${params.length}`
          : `WHERE c.tower_id = $${params.length}`;
      } else if (scope.scope_type === 'company' && scope.scope_id) {
        params.push(scope.scope_id);
        where = where
          ? `${where} AND c.id = $${params.length}`
          : `WHERE c.id = $${params.length}`;
      } else {
        // Org/location users have no access to the tower hierarchy
        return res.json({ companies: [] });
      }
    }

    const { rows } = await pool.query(
      `SELECT c.id, c.tower_id, c.name, c.address, c.approval_chain, c.notify_channels,
              c.created_by, c.created_at, c.updated_at,
              ${latestImageSql('company', 'c')} AS image_url,
              t.name AS tower_name
       FROM companies c LEFT JOIN towers t ON t.id = c.tower_id
       ${where} ORDER BY c.created_at DESC`, params
    );
    res.json({ companies: await resolveImageRows(rows) });
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

    const { rows } = await pool.query(
      `INSERT INTO companies (tower_id, name, address, image_url, approval_chain, notify_channels, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,'{"bypass_enabled":false,"steps":[]}'::jsonb),
                              COALESCE($6,'{"whatsapp":true,"email":true,"call":false,"push":true}'::jsonb), $7)
       RETURNING *`,
      [tower_id, name, address || null, image_url || null,
       approval_chain ? JSON.stringify(approval_chain) : null,
       notify_channels ? JSON.stringify(notify_channels) : null,
       req.user.id]
    );
    res.status(201).json({ company: await resolveImageRow(rows[0]) });
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
    const { rows: [existing] } = await pool.query(
      'SELECT notify_channels FROM companies WHERE id = $1', [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: 'Company not found' });

    const mergedConfig = notify_channels !== undefined
      ? mergeEntityConfig(existing.notify_channels, notify_channels)
      : null;

    const { rows } = await pool.query(
      `UPDATE companies SET
         name = COALESCE($1, name),
         address = COALESCE($2, address),
         image_url = COALESCE($3, image_url),
         approval_chain = COALESCE($4::jsonb, approval_chain),
         notify_channels = COALESCE($5::jsonb, notify_channels),
         updated_at = now()
       WHERE id = $6 RETURNING *`,
      [name, address, image_url,
       approval_chain ? JSON.stringify(approval_chain) : null,
       mergedConfig ? JSON.stringify(mergedConfig) : null,
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Company not found' });
    const company = await resolveImageRow(rows[0]);
    res.json({ company: { ...company, config: normalizeEntityConfig(rows[0].notify_channels) } });
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

    await pool.query('DELETE FROM companies WHERE id = $1', [req.params.id]);
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
    const scope = await getUserTopScope(req.user.id);
    let where = ''; let params = [];

    // Only global/support and organization-scoped users may list organizations.
    // Location users must use GET /locations for their own entity.
    if (!isGlobalScope(scope)) {
      if (scope.scope_type === 'organization' && scope.scope_id) {
        where = 'WHERE o.id = $1'; params = [scope.scope_id];
      } else {
        return res.json({ organizations: [] });
      }
    }

    const locCountExpr = `(SELECT COUNT(*)::int FROM locations l WHERE l.organization_id = o.id)`;

    const { rows } = await pool.query(`
      SELECT o.id, o.name, o.address, o.notify_channels, o.created_by, o.created_at, o.updated_at,
        ${latestImageSql('organization', 'o')} AS image_url,
        ${locCountExpr} AS location_count
      FROM organizations o
      ${where}
      ORDER BY o.created_at DESC
    `, params);
    res.json({ organizations: await resolveImageRows(rows) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load organizations' });
  }
});

router.get('/organizations/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'organization', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    const { rows: [org] } = await pool.query('SELECT * FROM organizations WHERE id = $1', [req.params.id]);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const { rows: locations } = await pool.query(
      'SELECT * FROM locations WHERE organization_id = $1 ORDER BY created_at DESC', [req.params.id]
    );
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
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, address, image_url, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, address || null, image_url || null, req.user.id]
    );
    res.status(201).json({ organization: await resolveImageRow(rows[0]) });
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
    const { rows: [existing] } = await pool.query(
      'SELECT notify_channels FROM organizations WHERE id = $1', [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: 'Organization not found' });

    const mergedConfig = notify_channels !== undefined
      ? mergeEntityConfig(existing.notify_channels, notify_channels)
      : null;

    const { rows } = await pool.query(
      `UPDATE organizations SET
         name = COALESCE($1, name),
         address = COALESCE($2, address),
         image_url = COALESCE($3, image_url),
         notify_channels = COALESCE($4::jsonb, notify_channels),
         updated_at = now()
       WHERE id = $5 RETURNING *`,
      [name, address, image_url,
       mergedConfig ? JSON.stringify(mergedConfig) : null,
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: await resolveImageRow(rows[0]) });
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

    await pool.query('DELETE FROM organizations WHERE id = $1', [req.params.id]);
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
    const scope = await getUserTopScope(req.user.id);
    const params = [];
    let where = '';

    if (req.query.organization_id) {
      params.push(req.query.organization_id);
      where = `WHERE l.organization_id = $${params.length}`;
    }

    if (!isGlobalScope(scope)) {
      if (scope.scope_type === 'organization' && scope.scope_id) {
        params.push(scope.scope_id);
        where = where
          ? `${where} AND l.organization_id = $${params.length}`
          : `WHERE l.organization_id = $${params.length}`;
      } else if (scope.scope_type === 'location' && scope.scope_id) {
        params.push(scope.scope_id);
        where = where
          ? `${where} AND l.id = $${params.length}`
          : `WHERE l.id = $${params.length}`;
      } else {
        // Tower/company users have no access to the org hierarchy
        return res.json({ locations: [] });
      }
    }

    const { rows } = await pool.query(
      `SELECT l.id, l.organization_id, l.name, l.address, l.approval_chain, l.notify_channels,
              l.created_by, l.created_at, l.updated_at,
              ${latestImageSql('location', 'l')} AS image_url,
              o.name AS organization_name
       FROM locations l LEFT JOIN organizations o ON o.id = l.organization_id
       ${where} ORDER BY l.created_at DESC`, params
    );
    res.json({ locations: await resolveImageRows(rows) });
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

    const { rows } = await pool.query(
      `INSERT INTO locations (organization_id, name, address, image_url, approval_chain, notify_channels, created_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,'{"bypass_enabled":false,"steps":[]}'::jsonb),
                              COALESCE($6,'{"whatsapp":true,"email":true,"call":false,"push":true}'::jsonb), $7)
       RETURNING *`,
      [organization_id, name, address || null, image_url || null,
       approval_chain ? JSON.stringify(approval_chain) : null,
       notify_channels ? JSON.stringify(notify_channels) : null,
       req.user.id]
    );
    res.status(201).json({ location: await resolveImageRow(rows[0]) });
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
    const { rows: [existing] } = await pool.query(
      'SELECT notify_channels FROM locations WHERE id = $1', [req.params.id],
    );
    if (!existing) return res.status(404).json({ error: 'Location not found' });

    const mergedConfig = notify_channels !== undefined
      ? mergeEntityConfig(existing.notify_channels, notify_channels)
      : null;

    const { rows } = await pool.query(
      `UPDATE locations SET
         name = COALESCE($1, name),
         address = COALESCE($2, address),
         image_url = COALESCE($3, image_url),
         approval_chain = COALESCE($4::jsonb, approval_chain),
         notify_channels = COALESCE($5::jsonb, notify_channels),
         updated_at = now()
       WHERE id = $6 RETURNING *`,
      [name, address, image_url,
       approval_chain ? JSON.stringify(approval_chain) : null,
       mergedConfig ? JSON.stringify(mergedConfig) : null,
       req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Location not found' });
    const location = await resolveImageRow(rows[0]);
    res.json({ location: { ...location, config: normalizeEntityConfig(rows[0].notify_channels) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.delete('/locations/:id', async (req, res) => {
  try {
    if (!await canAccessEntity(req.user.id, 'location', req.params.id))
      return res.status(403).json({ error: 'Access denied' });

    await pool.query('DELETE FROM locations WHERE id = $1', [req.params.id]);
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

      const { rows: existing } = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [req.params.id]);
      if (!existing[0]) return res.status(404).json({ error: 'Entity not found' });

      const imageUrls = await insertEntityImages(entityType, req.params.id, files, req.user.id);
      const latestUrl = imageUrls[imageUrls.length - 1];

      const { rows: total } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM entity_images
         WHERE entity_type = $1 AND entity_id = $2`,
        [entityType, req.params.id]
      );

      res.json({
        image_url: latestUrl,
        image_urls: imageUrls,
        uploaded_count: imageUrls.length,
        total_images: total[0].cnt,
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

      const { rows: existing } = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [req.params.id]);
      if (!existing[0]) return res.status(404).json({ error: 'Entity not found' });

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
