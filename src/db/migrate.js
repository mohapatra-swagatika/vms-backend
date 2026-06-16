require('dotenv').config();
require('reflect-metadata');
const fs   = require('fs');
const path = require('path');
const { initializeDb, query } = require('./index');

async function migrate() {
  await initializeDb();

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    console.log(`Running migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await query(sql);
    console.log(`  ✅ Done`);
  }

  console.log('\n✅ All migrations complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
