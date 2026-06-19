const { repoByEntityType } = require('../db');
const { uploadBuffer, deleteByPrefix, entityProfileKey, resolveImageUrl, resolveImageRow } = require('./storage');
const { optimizeImage } = require('./imageOptimize');

/** Entity profile photos replace the previous file for this entity. */
async function deleteEntityProfileImage(entityType, entityId) {
  await deleteByPrefix(`entities/${entityType}/${entityId}/profile`);
}

async function uploadEntityProfileImage(entityType, entityId, file) {
  const entityRepo = repoByEntityType(entityType);
  const { buffer, contentType, ext } = await optimizeImage(file.buffer, file.mimetype);
  const key = entityProfileKey(entityType, entityId, `upload${ext}`);
  const storageRef = await uploadBuffer({ key, buffer, contentType });

  await entityRepo.update(entityId, { image_url: storageRef });
  const entity = await entityRepo.findOne({ where: { id: entityId } });
  if (!entity) return null;

  const imageUrl = await resolveImageUrl(storageRef);
  return {
    entity: await resolveImageRow(entity),
    image_url: imageUrl,
  };
}

module.exports = {
  deleteEntityProfileImage,
  uploadEntityProfileImage,
};
