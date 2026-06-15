const pool = require('../db/pool');
const { uploadBuffer, entityKey } = require('./storage');

/** Latest avatar URL from upload history; falls back to legacy image_url column. */
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
  return rows;
}

async function insertEntityImages(entityType, entityId, files, uploadedBy) {
  const imageUrls = [];
  for (const file of files) {
    const key = entityKey(entityType, entityId, file.originalname);
    const imageUrl = await uploadBuffer({
      key,
      buffer: file.buffer,
      contentType: file.mimetype,
    });
    await pool.query(
      `INSERT INTO entity_images (entity_type, entity_id, image_url, uploaded_by)
       VALUES ($1, $2, $3, $4)`,
      [entityType, entityId, imageUrl, uploadedBy]
    );
    imageUrls.push(imageUrl);
  }
  return imageUrls;
}

module.exports = { latestImageSql, listEntityImages, insertEntityImages };
