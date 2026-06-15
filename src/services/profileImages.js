const { deleteByPrefix } = require('./storage');

/** Profile images replace the previous file — remove any existing objects for this user. */
async function deleteProfileImages(userId) {
  await deleteByPrefix(`profiles/${userId}`);
}

module.exports = { deleteProfileImages };
