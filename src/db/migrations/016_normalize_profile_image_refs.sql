-- Store S3/local object keys in DB, not full localhost /media URLs.

UPDATE users
SET profile_image_url = regexp_replace(profile_image_url, '^.*/media/', '')
WHERE profile_image_url LIKE '%/media/profiles/%';

UPDATE user_images
SET image_url = regexp_replace(image_url, '^.*/media/', '')
WHERE image_url LIKE '%/media/profiles/%';
