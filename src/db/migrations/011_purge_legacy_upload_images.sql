-- Remove gallery rows that point at the old /uploads/ static folder (files no longer exist).

DELETE FROM entity_images WHERE image_url LIKE '%/uploads/%';
DELETE FROM user_images   WHERE image_url LIKE '%/uploads/%';

-- Re-sync entity avatar columns to the latest remaining gallery image (or NULL).
UPDATE towers t
SET image_url = (
  SELECT ei.image_url FROM entity_images ei
  WHERE ei.entity_type = 'tower' AND ei.entity_id = t.id
  ORDER BY ei.created_at DESC LIMIT 1
)
WHERE t.image_url LIKE '%/uploads/%';

UPDATE companies c
SET image_url = (
  SELECT ei.image_url FROM entity_images ei
  WHERE ei.entity_type = 'company' AND ei.entity_id = c.id
  ORDER BY ei.created_at DESC LIMIT 1
)
WHERE c.image_url LIKE '%/uploads/%';

UPDATE organizations o
SET image_url = (
  SELECT ei.image_url FROM entity_images ei
  WHERE ei.entity_type = 'organization' AND ei.entity_id = o.id
  ORDER BY ei.created_at DESC LIMIT 1
)
WHERE o.image_url LIKE '%/uploads/%';

UPDATE locations l
SET image_url = (
  SELECT ei.image_url FROM entity_images ei
  WHERE ei.entity_type = 'location' AND ei.entity_id = l.id
  ORDER BY ei.created_at DESC LIMIT 1
)
WHERE l.image_url LIKE '%/uploads/%';

UPDATE users u
SET profile_image_url = (
  SELECT ui.image_url FROM user_images ui
  WHERE ui.user_id = u.id
  ORDER BY ui.created_at DESC LIMIT 1
)
WHERE u.profile_image_url LIKE '%/uploads/%';
