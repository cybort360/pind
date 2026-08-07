import type pg from 'pg';
import type { AppState, ReviewPayload } from '../shared/types.js';
import { getPool } from './db/pool.js';
import { readAppState, readReviewPayload } from './db/assemble.js';
import { resetWorkspace } from './db/seed.js';

export interface Repository {
  readonly mode: 'postgres';
  readonly pool: pg.Pool;
  read(workspaceId: string): Promise<AppState>;
  readReviewPayload(token: string): Promise<ReviewPayload | null>;
  transaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T>;
  reset(workspaceId: string): Promise<AppState>;
}

class PostgresRepository implements Repository {
  readonly mode = 'postgres' as const;
  readonly pool: pg.Pool;

  constructor(pool?: pg.Pool) {
    this.pool = pool ?? getPool();
  }

  async read(workspaceId: string): Promise<AppState> {
    const state = await readAppState(this.pool, workspaceId);
    if (!state) {
      const error = new Error(`Workspace ${workspaceId} was not found`) as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    return state;
  }

  readReviewPayload(token: string): Promise<ReviewPayload | null> {
    return readReviewPayload(this.pool, token);
  }

  /** Runs fn inside a real transaction, rolling back on any rejection. */
  async transaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reset(workspaceId: string): Promise<AppState> {
    await resetWorkspace(this.pool, workspaceId);
    return this.read(workspaceId);
  }
}

export function createRepository(pool?: pg.Pool): Repository {
  return new PostgresRepository(pool);
}
