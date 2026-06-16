/**
 * @deprecated Use `require('./index')` — repo(), query(), or initializeDb().
 * Kept for scripts that still import pool; delegates to TypeORM.
 */
const {
  AppDataSource,
  initializeDb,
  poolQuery,
} = require('./index');

async function ensureReady() {
  if (!AppDataSource.isInitialized) await initializeDb();
}

module.exports = {
  query: async (text, params) => {
    await ensureReady();
    return poolQuery(text, params);
  },
  connect: async () => {
    await ensureReady();
    const runner = AppDataSource.createQueryRunner();
    await runner.connect();
    return {
      query: async (text, params) => {
        const rows = await runner.query(text, params);
        return { rows };
      },
      release: () => runner.release(),
    };
  },
};
