-- Multiple profile images per user; profile_image_url holds the latest avatar.

CREATE TABLE IF NOT EXISTS user_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url   VARCHAR(500) NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_images_latest
  ON user_images(user_id, created_at DESC);

INSERT INTO user_images (user_id, image_url, created_at)
SELECT u.id, u.profile_image_url, COALESCE(u.updated_at, u.created_at)
FROM users u
WHERE u.profile_image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_images ui
    WHERE ui.user_id = u.id AND ui.image_url = u.profile_image_url
  );
