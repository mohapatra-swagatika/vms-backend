CREATE TABLE IF NOT EXISTS towers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  address     TEXT,
  image_url   VARCHAR(500),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  address     TEXT,
  image_url   VARCHAR(500),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tower_id         UUID REFERENCES towers(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  address          TEXT,
  image_url        VARCHAR(500),
  approval_chain   JSONB DEFAULT '{"bypass_enabled":false,"steps":[]}',
  notify_channels  JSONB DEFAULT '{"whatsapp":true,"email":true,"call":false,"push":true}',
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  address          TEXT,
  image_url        VARCHAR(500),
  approval_chain   JSONB DEFAULT '{"bypass_enabled":false,"steps":[]}',
  notify_channels  JSONB DEFAULT '{"whatsapp":true,"email":true,"call":false,"push":true}',
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_tower ON companies(tower_id);
CREATE INDEX IF NOT EXISTS idx_locations_org ON locations(organization_id);
