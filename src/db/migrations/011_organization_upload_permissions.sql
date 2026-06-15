-- Image upload + Employee CSV upload permissions for organization role.
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
        UNION SELECT 'image:upload_self'::text
        UNION SELECT 'image:upload_child'::text
        UNION SELECT 'employee:csv_upload_self'::text
        UNION SELECT 'employee:csv_upload_child'::text
      ) AS merged(v)
    ),
    '[]'::jsonb
  )
),
updated_at = now()
WHERE r.name = 'organization'
  AND r.is_system = true;
