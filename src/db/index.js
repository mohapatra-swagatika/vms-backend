require('reflect-metadata');
const { AppDataSource } = require('./data-source');
const { TABLE_TO_ENTITY, ENTITY_TYPE_TO_REPO } = require('./entities');

async function initializeDb() {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  return AppDataSource;
}

function repo(entityName) {
  return AppDataSource.getRepository(entityName);
}

function repoByTable(table) {
  const entityName = TABLE_TO_ENTITY[table];
  if (!entityName) throw new Error(`Unknown table: ${table}`);
  return repo(entityName);
}

function repoByEntityType(entityType) {
  const entityName = ENTITY_TYPE_TO_REPO[entityType];
  if (!entityName) throw new Error(`Unknown entity type: ${entityType}`);
  return repo(entityName);
}

/** Run parameterized SQL via TypeORM (returns row array). */
async function query(sql, params = []) {
  return AppDataSource.query(sql, params);
}

/** pg-compatible `{ rows }` wrapper for legacy call sites. */
async function poolQuery(sql, params = []) {
  const rows = await query(sql, params);
  return { rows };
}

function pgErrorCode(err) {
  return err?.driverError?.code || err?.code;
}

function isUniqueViolation(err) {
  return pgErrorCode(err) === '23505';
}

module.exports = {
  AppDataSource,
  initializeDb,
  repo,
  repoByTable,
  repoByEntityType,
  query,
  poolQuery,
  pgErrorCode,
  isUniqueViolation,
};
