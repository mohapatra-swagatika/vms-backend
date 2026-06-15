-- Multiple images per entity; image_url on entity tables holds the latest avatar.

CREATE TABLE IF NOT EXISTS entity_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('tower', 'company', 'organization', 'location')),
  entity_id   UUID NOT NULL,
  image_url   VARCHAR(500) NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_images_latest
  ON entity_images(entity_type, entity_id, created_at DESC);

-- Backfill existing single images into history (idempotent)
INSERT INTO entity_images (entity_type, entity_id, image_url, created_at)
SELECT 'tower', t.id, t.image_url, COALESCE(t.updated_at, t.created_at)
FROM towers t
WHERE t.image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entity_images ei
    WHERE ei.entity_type = 'tower' AND ei.entity_id = t.id AND ei.image_url = t.image_url
  );

INSERT INTO entity_images (entity_type, entity_id, image_url, created_at)
SELECT 'company', c.id, c.image_url, COALESCE(c.updated_at, c.created_at)
FROM companies c
WHERE c.image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entity_images ei
    WHERE ei.entity_type = 'company' AND ei.entity_id = c.id AND ei.image_url = c.image_url
  );

INSERT INTO entity_images (entity_type, entity_id, image_url, created_at)
SELECT 'organization', o.id, o.image_url, COALESCE(o.updated_at, o.created_at)
FROM organizations o
WHERE o.image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entity_images ei
    WHERE ei.entity_type = 'organization' AND ei.entity_id = o.id AND ei.image_url = o.image_url
  );

INSERT INTO entity_images (entity_type, entity_id, image_url, created_at)
SELECT 'location', l.id, l.image_url, COALESCE(l.updated_at, l.created_at)
FROM locations l
WHERE l.image_url IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entity_images ei
    WHERE ei.entity_type = 'location' AND ei.entity_id = l.id AND ei.image_url = l.image_url
  );
