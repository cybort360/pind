import pg from 'pg';
import { runMigrations } from '../../server/db/migrate';

const { Pool } = pg;

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/pind_test';

/** Connects to the test database, creating it if it does not exist. */
export async function withTestDatabase(): Promise<pg.Pool> {
  const url = new URL(TEST_DATABASE_URL);
  const databaseName = url.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';

  const admin = new Pool({ connectionString: adminUrl.toString(), ssl: false });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (existing.rowCount === 0) {
      // CREATE DATABASE cannot be parameterised or run inside a transaction.
      await admin.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: TEST_DATABASE_URL, ssl: false });
  await runMigrations(pool);
  return pool;
}

const TABLES = [
  'notifications', 'activities', 'review_tokens', 'decisions', 'comments',
  'revisions', 'milestones', 'projects', 'clients', 'users', 'workspaces',
];

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
