import 'dotenv/config';
import { closePool, getPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { resetWorkspace, seedWorkspace } from './db/seed.js';
import { DEMO_WORKSPACE_ID } from './seed-data.js';

const pool = getPool();
await runMigrations(pool);

if (process.argv.includes('--reset')) {
  await resetWorkspace(pool, DEMO_WORKSPACE_ID);
  console.log('Northstar demo workspace reset.');
} else {
  const { inserted } = await seedWorkspace(pool);
  console.log(inserted ? 'Northstar demo workspace seeded.' : 'Northstar demo workspace already present.');
}

await closePool();
