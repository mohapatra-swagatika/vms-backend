-- Visitor records scoped to the entity hierarchy (tower, company, organization, location).
-- Mirrors employees polymorphic entity_type / entity_id pattern for consistent API scoping.

CREATE TABLE IF NOT EXISTS visitors (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         VARCHAR(20) NOT NULL CHECK (entity_type IN ('tower', 'company', 'organization', 'location')),
  entity_id           UUID NOT NULL,

  full_name           VARCHAR(255) NOT NULL,
  email               VARCHAR(255),
  phone               VARCHAR(30),
  company_name        VARCHAR(255),
  id_type             VARCHAR(50),
  id_number           VARCHAR(100),

  purpose             TEXT,
  host_name           VARCHAR(255),
  host_employee_id    UUID REFERENCES employees(id) ON DELETE SET NULL,

  status              VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'checked_in', 'checked_out', 'cancelled', 'rejected'
  )),

  scheduled_arrival   TIMESTAMPTZ,
  scheduled_departure TIMESTAMPTZ,
  checked_in_at       TIMESTAMPTZ,
  checked_out_at      TIMESTAMPTZ,

  notes               TEXT,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitors_entity ON visitors(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_visitors_status ON visitors(status);
CREATE INDEX IF NOT EXISTS idx_visitors_full_name ON visitors(full_name);
CREATE INDEX IF NOT EXISTS idx_visitors_scheduled_arrival ON visitors(scheduled_arrival);
CREATE INDEX IF NOT EXISTS idx_visitors_host_employee ON visitors(host_employee_id)
  WHERE host_employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_entity_email
  ON visitors(entity_type, entity_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

-- Visitor CRUD permissions for system roles (idempotent).
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
        UNION SELECT 'visitor:create'::text WHERE r.name IN ('support', 'tower', 'organization', 'company', 'location', 'admin', 'front_desk', 'gate')
        UNION SELECT 'visitor:read'::text   WHERE r.name IN ('support', 'tower', 'organization', 'company', 'location', 'admin', 'front_desk', 'gate')
        UNION SELECT 'visitor:update'::text WHERE r.name IN ('support', 'tower', 'organization', 'company', 'location', 'admin', 'front_desk', 'gate')
        UNION SELECT 'visitor:delete'::text WHERE r.name IN ('support', 'tower', 'organization', 'company', 'location', 'admin', 'front_desk', 'gate')
      ) AS merged(v)
    ),
    '[]'::jsonb
  )
),
updated_at = now()
WHERE r.is_system = true
  AND r.name IN ('support', 'tower', 'organization', 'company', 'location', 'admin', 'front_desk', 'gate');
