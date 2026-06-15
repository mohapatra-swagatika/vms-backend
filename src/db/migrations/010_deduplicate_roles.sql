-- Fix duplicate system roles caused by re-running 004_seed_system_roles.sql.
-- UNIQUE(name, entity_id) does not dedupe when entity_id IS NULL (PostgreSQL NULL semantics).

-- 1. Re-point assignments from duplicate roles to the canonical (oldest) role per name.
WITH ranked AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC NULLS LAST, id ASC) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY name ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS keeper_id
  FROM roles
  WHERE entity_id IS NULL
),
dupes AS (
  SELECT id AS dupe_id, keeper_id FROM ranked WHERE rn > 1
)
UPDATE user_role_assignments ura
SET role_id = d.keeper_id
FROM dupes d
WHERE ura.role_id = d.dupe_id;

-- 2. Re-point custom-role parent links.
WITH ranked AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC NULLS LAST, id ASC) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY name ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS keeper_id
  FROM roles
  WHERE entity_id IS NULL
),
dupes AS (
  SELECT id AS dupe_id, keeper_id FROM ranked WHERE rn > 1
)
UPDATE roles r
SET parent_role_id = d.keeper_id
FROM dupes d
WHERE r.parent_role_id = d.dupe_id;

-- 3. Remove duplicate rows.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at ASC NULLS LAST, id ASC) AS rn
  FROM roles
  WHERE entity_id IS NULL
)
DELETE FROM roles
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 4. Prevent future duplicates when entity_id IS NULL (system seeds + global custom roles).
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_name_null_entity
  ON roles (name) WHERE entity_id IS NULL;
