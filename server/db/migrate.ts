import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { getPool, closePool } from './pool.js';

// Arbitrary but fixed: every instance must contend for the same lock id.
const MIGRATION_LOCK_ID = 8_147_233;

const migrationsDir = path.resolve(fileURLToPath(new URL('../migrations', import.meta.url)));

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = await fs.readdir(migrationsDir);
  const files = entries.filter((entry) => entry.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => {
      const version = Number.parseInt(name.slice(0, 3), 10);
      if (!Number.isInteger(version)) {
        throw new Error(`Migration ${name} must start with a three-digit version prefix`);
      }
      return { version, name, sql: await fs.readFile(path.join(migrationsDir, name), 'utf8') };
    }),
  );
}

/**
 * Applies pending migrations and returns how many ran.
 *
 * Replit autoscale can boot several instances at once, so the whole run is
 * wrapped in a session-level advisory lock; losers block, then observe an
 * empty pending set.
 */
export async function runMigrations(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const done = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const seen = new Set(done.rows.map((row) => row.version));

    for (const migration of await loadMigrations()) {
      if (seen.has(migration.version)) continue;
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [
          migration.version,
          migration.name,
        ]);
        await client.query('COMMIT');
        applied += 1;
        console.log(`Applied migration ${migration.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

// `npm run db:migrate`
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config();
  const applied = await runMigrations(getPool());
  console.log(applied === 0 ? 'Schema already up to date.' : `Applied ${applied} migration(s).`);
  await closePool();
}
