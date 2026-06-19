
-- Gallery image delete permissions (self and child) for entity-scoped system roles.

UPDATE roles r
SET permissions = jsonb_set(
  r.permissions,
  '{actions}',
  COALESCE(
    (
      SELECT jsonb_agg(DISTINCT v)
      FROM (
        SELECT elem AS v
        FROM jsonb_array_elements_text(r.permissions->'actions') AS elem
        UNION
        SELECT 'image:delete_upload_self'::text
        UNION
        SELECT 'image:delete_upload_child'::text
      ) AS merged(v)
    ),
    '[]'::jsonb
  )
),
updated_at = now()
WHERE r.name IN ('tower', 'organization', 'company', 'location')
  AND r.is_system = true;
