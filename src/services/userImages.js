const { repo } = require('../db');
const { resolveImageRows, resolveProfile } = require('./storage');

const USER_PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  phone: true,
  is_active: true,
  created_at: true,
  profile_image_url: true,
};

async function listUserImages(userId) {
  const rows = await repo('UserImage').find({
    where: { user_id: userId },
    order: { created_at: 'DESC' },
    select: { id: true, image_url: true, created_at: true },
  });
  return resolveImageRows(rows);
}

async function getUserGallery(userId) {
  const [user, images] = await Promise.all([
    repo('User').findOne({
      where: { id: userId, is_active: true },
      select: USER_PUBLIC_FIELDS,
    }),
    listUserImages(userId),
  ]);

  if (!user) return null;

  return {
    user: await resolveProfile(user),
    images,
  };
}

module.exports = {
  listUserImages,
  getUserGallery,
};
