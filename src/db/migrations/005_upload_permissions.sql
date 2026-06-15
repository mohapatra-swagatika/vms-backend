-- Image upload + Employee CSV upload permissions (self and child) for tower, company, and location roles.
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
        WHERE elem NOT IN (
          'image:upload',
          'image:upload_self_or_child',
          'employee:csv_upload'
        )
        UNION
        SELECT 'image:upload_self'::text
        UNION
        SELECT 'image:upload_child'::text
        UNION
        SELECT 'employee:csv_upload_self'::text
        UNION
        SELECT 'employee:csv_upload_child'::text
      ) AS merged(v)
    ),
    '[]'::jsonb
  )
),
updated_at = now()
WHERE r.name IN ('tower', 'company', 'location')
  AND r.is_system = true;
