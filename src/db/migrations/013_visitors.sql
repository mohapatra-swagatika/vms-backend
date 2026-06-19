-- Visitor records for mobile check-in flows.

CREATE TABLE IF NOT EXISTS visitors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   VARCHAR(20) NOT NULL CHECK (entity_type IN ('tower', 'company', 'organization', 'location')),
  entity_id     UUID NOT NULL,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255),
  phone         VARCHAR(30),
  purpose       VARCHAR(100),
  host_name     VARCHAR(255),
  host_email    VARCHAR(255),
  organization  VARCHAR(255),
  department    VARCHAR(100),
  status        VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'checked_in', 'checked_out')),
  check_in_at   TIMESTAMPTZ,
  check_out_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitors_entity ON visitors(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_visitors_status ON visitors(status);
CREATE INDEX IF NOT EXISTS idx_visitors_created_at ON visitors(created_at DESC);
