import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { runMigrations } from '../server/db/migrate';
import { withTestDatabase } from './helpers/db';

let pool: pg.Pool;

beforeAll(async () => { pool = await withTestDatabase(); });
afterAll(async () => { await pool.end(); });

describe('migrations', () => {
  it('creates every expected table', async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = result.rows.map((row) => row.table_name);
    for (const table of [
      'activities', 'clients', 'comments', 'decisions', 'milestones',
      'notifications', 'projects', 'review_tokens', 'revisions',
      'schema_migrations', 'users', 'workspaces',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('records one row per migration file', async () => {
    const result = await pool.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(result.rows).toEqual([{ version: 1 }]);
  });

  it('is a no-op when run again', async () => {
    const applied = await runMigrations(pool);
    expect(applied).toBe(0);
    const result = await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
    expect(result.rows[0].count).toBe(1);
  });

  it('drops the legacy JSONB state table', async () => {
    const result = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'pind_app_state'`,
    );
    expect(result.rowCount).toBe(0);
  });
});
