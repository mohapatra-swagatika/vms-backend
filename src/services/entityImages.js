const { repo, repoByEntityType } = require('../db');
const { uploadBuffer, entityKey, resolveImageRows, resolveImageUrl, resolveImageRow } = require('./storage');
const { optimizeImage } = require('./imageOptimize');
const { isGlobalScope } = require('./userScope');

const SCOPED_ENTITY_TYPES = new Set(['tower', 'company', 'organization', 'location']);

function getScopedEntity(top) {
  if (!top?.scope_id || isGlobalScope(top)) return null;
  if (!SCOPED_ENTITY_TYPES.has(top.scope_type)) return null;
  return { type: top.scope_type, id: top.scope_id };
}

async function listEntityImages(entityType, entityId) {
  const rows = await repo('EntityImage').find({
    where: { entity_type: entityType, entity_id: entityId },
    order: { created_at: 'DESC' },
    select: { id: true, image_url: true, created_at: true },
  });
  return resolveImageRows(rows);
}

async function getEntityGallery(entityType, entityId) {
  const entityRepo = repoByEntityType(entityType);

  const [entity, images] = await Promise.all([
    entityRepo.findOne({ where: { id: entityId }, select: { name: true } }),
    listEntityImages(entityType, entityId),
  ]);

  return { entity_name: entity?.name ?? null, images };
}

/** Upload files to storage; store keys/URLs in DB; return client-facing URLs. */
async function insertEntityImages(entityType, entityId, files, uploadedBy) {
  const imageRepo = repo('EntityImage');
  const entityRepo = repoByEntityType(entityType);
  const signedUrls = [];
  let latestRef = null;

  for (const file of files) {
    const { buffer, contentType, ext } = await optimizeImage(file.buffer, file.mimetype);
    const key = entityKey(entityType, entityId, `upload${ext}`);
    const storageRef = await uploadBuffer({ key, buffer, contentType });
    await imageRepo.save({
      entity_type: entityType,
      entity_id: entityId,
      image_url: storageRef,
      uploaded_by: uploadedBy,
    });
    latestRef = storageRef;
    signedUrls.push(await resolveImageUrl(storageRef));
  }

  if (latestRef) {
    await entityRepo.update(entityId, { image_url: latestRef });
  }
  return signedUrls;
}

module.exports = {
  listEntityImages,
  getEntityGallery,
  getScopedEntity,
  insertEntityImages,
  resolveImageRow,
  resolveImageRows,
};
