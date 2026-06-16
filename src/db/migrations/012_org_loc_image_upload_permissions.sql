-- Image upload permissions (self and child) for organization and location system roles.
-- Idempotent: safe to re-run on every migrate.

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
        SELECT 'image:upload_self'::text
        UNION
        SELECT 'image:upload_child'::text
      ) AS merged(v)
    ),
    '[]'::jsonb
  )
),
updated_at = now()
WHERE r.name IN ('organization', 'location')
  AND r.is_system = true;
