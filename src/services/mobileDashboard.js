const { repoByTable } = require('../db');
const { getUserTopScope } = require('../db/queries/assignments');
const { getEffectivePermissions } = require('./permissions');
const { getEntityGallery, getScopedEntity } = require('./entityImages');
const { normalizeEntityConfig, sanitizeEntityConfig } = require('./entityConfig');
const { getNotificationRecipients } = require('./notificationRecipients');
const { hasMobilePortalAccess } = require('./mobileAccess');
const { TABLE_BY_TYPE, getParentEntity } = require('./entityHierarchy');

const EMPTY_SCOPE = {
  scope_type: null,
  scope_id: null,
  role_name: null,
  level: null,
  entity_type: null,
  entity_id: null,
  entity_name: null,
};

async function getEntityName(entityType, entityId) {
  const table = TABLE_BY_TYPE[entityType];
  if (!table) return null;
  const row = await repoByTable(table).findOne({
    where: { id: entityId },
    select: { name: true },
  });
  return row?.name ?? null;
}

/** User's active top role assignment → scoped entity (tower/company/org/location). */
async function resolveUserScopeContext(userId) {
  const top = await getUserTopScope(userId);
  if (!top) return { ...EMPTY_SCOPE };

  const scoped = getScopedEntity(top);
  if (!scoped) {
    return {
      scope_type: top.scope_type ?? 'global',
      scope_id: top.scope_id ?? null,
      role_name: top.role_name ?? null,
      level: top.level ?? null,
      entity_type: null,
      entity_id: null,
      entity_name: null,
    };
  }

  return {
    scope_type: top.scope_type,
    scope_id: top.scope_id,
    role_name: top.role_name,
    level: top.level,
    entity_type: scoped.type,
    entity_id: scoped.id,
    entity_name: await getEntityName(scoped.type, scoped.id),
  };
}

async function hasDashboardAccessAtScope(userId, entityType, entityId) {
  const { allowed } = await getEffectivePermissions(userId, entityType, entityId);
  return hasMobilePortalAccess(allowed);
}

/**
 * Which entity's images to show: user scope first, parent fallback when empty.
 * Returns { entity_type, entity_id, source }.
 */
async function resolveImageEntity(userId, scope) {
  if (!scope.entity_type || !scope.entity_id) {
    return { entity_type: null, entity_id: null, source: null };
  }

  const scoped = { type: scope.entity_type, id: scope.entity_id };
  const parent = await getParentEntity(scoped.type, scoped.id);
  const selfAllowed = await hasDashboardAccessAtScope(userId, scoped.type, scoped.id);

  if (selfAllowed) {
    const selfGallery = await getEntityGallery(scoped.type, scoped.id);
    if (selfGallery.images.length > 0) {
      return { entity_type: scoped.type, entity_id: scoped.id, source: 'self' };
    }

    if (parent) {
      const parentGallery = await getEntityGallery(parent.type, parent.id);
      if (parentGallery.images.length > 0) {
        return { entity_type: parent.type, entity_id: parent.id, source: 'parent' };
      }
    }

    return { entity_type: scoped.type, entity_id: scoped.id, source: 'self' };
  }

  if (parent) {
    const parentAllowed = await hasDashboardAccessAtScope(userId, parent.type, parent.id);
    const parentGallery = await getEntityGallery(parent.type, parent.id);
    if (parentAllowed || parentGallery.images.length > 0) {
      return { entity_type: parent.type, entity_id: parent.id, source: 'parent' };
    }
  }

  return { entity_type: scoped.type, entity_id: scoped.id, source: 'self' };
}

async function loadConfigForEntity(entityType, entityId) {
  const table = TABLE_BY_TYPE[entityType];
  if (!table) return null;

  const row = await repoByTable(table).findOne({
    where: { id: entityId },
    select: { notify_channels: true },
  });
  if (!row) return null;

  const recipients = await getNotificationRecipients(entityType, entityId);
  return {
    config: sanitizeEntityConfig(row.notify_channels, recipients),
    recipients,
  };
}

async function getDashboardGalleryForUser(userId) {
  const scope = await resolveUserScopeContext(userId);
  const imageEntity = await resolveImageEntity(userId, scope);

  if (!imageEntity.entity_type || !imageEntity.entity_id) {
    return { scope, source: null, images: [] };
  }

  const gallery = await getEntityGallery(imageEntity.entity_type, imageEntity.entity_id);
  return {
    scope,
    entity_type: imageEntity.entity_type,
    entity_id: imageEntity.entity_id,
    entity_name: gallery.entity_name,
    source: imageEntity.source,
    images: gallery.images,
  };
}

/** Config is always loaded from the user's own scoped entity. */
async function getDashboardConfigForUser(userId) {
  const scope = await resolveUserScopeContext(userId);
  const emptyRecipients = { gate: [], front_desk: [], admin: [], level_bands: {} };

  if (!scope.entity_type || !scope.entity_id) {
    return {
      scope,
      config: normalizeEntityConfig(null),
      recipients: emptyRecipients,
    };
  }

  const payload = await loadConfigForEntity(scope.entity_type, scope.entity_id);
  return {
    scope,
    config: payload?.config ?? normalizeEntityConfig(null),
    recipients: payload?.recipients ?? emptyRecipients,
  };
}

module.exports = {
  resolveUserScopeContext,
  getDashboardGalleryForUser,
  getDashboardConfigForUser,
  getParentEntity,
};
