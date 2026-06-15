-- Dedicated employees table (business records, separate from application users).

CREATE TABLE IF NOT EXISTS employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   VARCHAR(20) NOT NULL CHECK (entity_type IN ('tower', 'company', 'organization', 'location')),
  entity_id     UUID NOT NULL,
  employee_code VARCHAR(50),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255),
  phone         VARCHAR(30),
  department    VARCHAR(100),
  job_title     VARCHAR(100),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_entity ON employees(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_entity_email
  ON employees(entity_type, entity_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- Employee CRUD permissions for system roles (idempotent).
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
        UNION SELECT 'employee:create'::text WHERE r.name IN ('support', 'tower', 'organization', 'company', 'location')
        UNION SELECT 'employee:read'::text   WHERE r.name IN ('support', 'tower', 'organization', 'company', 'location', 'admin')
        UNION SELECT 'employee:update'::text WHERE r.name IN ('support', 'tower', 'organization', 'company', 'location')
        UNION SELECT 'employee:delete'::text WHERE r.name IN ('support', 'tower', 'organization', 'company', 'location')
        UNION SELECT 'employee:csv_upload_self'::text  WHERE r.name IN ('tower', 'company', 'location', 'organization')
        UNION SELECT 'employee:csv_upload_child'::text WHERE r.name IN ('tower', 'company', 'location', 'organization')
      ) AS merged(v)
    ),
    '[]'::jsonb
  )
),
updated_at = now()
WHERE r.is_system = true
  AND r.name IN ('support', 'tower', 'organization', 'company', 'location', 'admin');
