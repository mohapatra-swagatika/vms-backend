CREATE TABLE IF NOT EXISTS roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  level           INTEGER NOT NULL,
  entity_id       UUID,
  entity_type     VARCHAR(50) DEFAULT 'any',
  permissions     JSONB NOT NULL DEFAULT '{}',
  is_system       BOOLEAN NOT NULL DEFAULT false,
  parent_role_id  UUID REFERENCES roles(id),
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(name, entity_id)
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id      UUID NOT NULL REFERENCES roles(id),
  scope_type   VARCHAR(50) NOT NULL,
  scope_id     UUID,
  assigned_by  UUID REFERENCES users(id),
  assigned_at  TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  UNIQUE(user_id, role_id, scope_type)
);

CREATE INDEX IF NOT EXISTS idx_ura_user       ON user_role_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_ura_scope      ON user_role_assignments(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_ura_expires    ON user_role_assignments(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_roles_entity   ON roles(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_roles_level    ON roles(level);
CREATE INDEX IF NOT EXISTS idx_roles_perm_gin ON roles USING GIN (permissions);
