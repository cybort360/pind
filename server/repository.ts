import fs from 'node:fs/promises';
import path from 'node:path';
// `pg` is CommonJS and assigns its exports dynamically, so Node's ESM loader
// cannot statically detect named exports. Import the default and destructure.
import pg from 'pg';
import type { AppState } from '../shared/types.js';

const { Pool } = pg;
type Pool = pg.Pool;
import { seedState } from './seed-data.js';

export interface Repository {
  read(): Promise<AppState>;
  write(state: AppState): Promise<void>;
  reset(): Promise<AppState>;
  mode: 'postgres' | 'file';
}

class FileRepository implements Repository {
  mode = 'file' as const;
  private readonly filePath = path.resolve(process.cwd(), '.data/pind.json');

  async read(): Promise<AppState> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw) as AppState;
    } catch {
      await this.write(seedState);
      return structuredClone(seedState);
    }
  }

  async write(state: AppState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async reset(): Promise<AppState> {
    const state = structuredClone(seedState);
    await this.write(state);
    return state;
  }
}

class PostgresRepository implements Repository {
  mode = 'postgres' as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }

  private async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pind_app_state (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async read(): Promise<AppState> {
    await this.ensureTable();
    const result = await this.pool.query<{ payload: AppState }>(
      'SELECT payload FROM pind_app_state WHERE id = $1',
      ['default'],
    );

    if (!result.rows[0]) {
      await this.write(seedState);
      return structuredClone(seedState);
    }

    return result.rows[0].payload;
  }

  async write(state: AppState): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `INSERT INTO pind_app_state (id, payload, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (id)
       DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      ['default', JSON.stringify(state)],
    );
  }

  async reset(): Promise<AppState> {
    const state = structuredClone(seedState);
    await this.write(state);
    return state;
  }
}

export function createRepository(): Repository {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  return databaseUrl ? new PostgresRepository(databaseUrl) : new FileRepository();
}
