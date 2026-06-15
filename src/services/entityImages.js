const pool = require('../db/pool');
const { uploadBuffer, entityKey, resolveImageRows, resolveImageUrl, resolveImageRow } = require('./storage');
const { optimizeImage } = require('./imageOptimize');

const ENTITY_TABLE = {
  tower: 'towers',
  company: 'companies',
  organization: 'organizations',
  location: 'locations',
};

/** Latest avatar key from upload history; falls back to legacy image_url column. */
function latestImageSql(entityType, tableAlias) {
  return `COALESCE(
    (SELECT ei.image_url FROM entity_images ei
     WHERE ei.entity_type = '${entityType}' AND ei.entity_id = ${tableAlias}.id
     ORDER BY ei.created_at DESC LIMIT 1),
    ${tableAlias}.image_url
  )`;
}

async function listEntityImages(entityType, entityId) {
  const { rows } = await pool.query(
    `SELECT id, image_url, created_at
     FROM entity_images
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY created_at DESC`,
    [entityType, entityId]
  );
  return resolveImageRows(rows);
}

async function getEntityGallery(entityType, entityId) {
  const table = ENTITY_TABLE[entityType];
  if (!table) throw new Error(`Unknown entity type: ${entityType}`);

  const [{ rows: [entity] }, images] = await Promise.all([
    pool.query(`SELECT name FROM ${table} WHERE id = $1`, [entityId]),
    listEntityImages(entityType, entityId),
  ]);

  return { entity_name: entity?.name ?? null, images };
}

/** Upload files to storage; store keys/URLs in DB; return client-facing URLs. */
async function insertEntityImages(entityType, entityId, files, uploadedBy) {
  const signedUrls = [];
  let latestRef = null;
  for (const file of files) {
    const { buffer, contentType, ext } = await optimizeImage(file.buffer, file.mimetype);
    const key = entityKey(entityType, entityId, `upload${ext}`);
    const storageRef = await uploadBuffer({ key, buffer, contentType });
    await pool.query(
      `INSERT INTO entity_images (entity_type, entity_id, image_url, uploaded_by)
       VALUES ($1, $2, $3, $4)`,
      [entityType, entityId, storageRef, uploadedBy]
    );
    latestRef = storageRef;
    signedUrls.push(await resolveImageUrl(storageRef));
  }
  const table = ENTITY_TABLE[entityType];
  if (table && latestRef) {
    await pool.query(
      `UPDATE ${table} SET image_url = $1, updated_at = now() WHERE id = $2`,
      [latestRef, entityId]
    );
  }
  return signedUrls;
}

module.exports = {
  latestImageSql,
  listEntityImages,
  getEntityGallery,
  insertEntityImages,
  resolveImageRow,
  resolveImageRows,
};
