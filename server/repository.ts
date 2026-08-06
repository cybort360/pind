import type pg from 'pg';
import type { AppState, ReviewPayload } from '../shared/types.js';
import { getPool } from './db/pool.js';
import { readAppState, readReviewPayload } from './db/assemble.js';
import { resetWorkspace } from './db/seed.js';

export interface Repository {
  mode: 'postgres';
  read(workspaceId: string): Promise<AppState>;
  readReviewPayload(token: string): Promise<ReviewPayload | null>;
  transaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T>;
  reset(workspaceId: string): Promise<AppState>;
}

class PostgresRepository implements Repository {
  mode = 'postgres' as const;

  async read(workspaceId: string): Promise<AppState> {
    const state = await readAppState(getPool(), workspaceId);
    if (!state) {
      const error = new Error(`Workspace ${workspaceId} was not found`) as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    return state;
  }

  readReviewPayload(token: string): Promise<ReviewPayload | null> {
    return readReviewPayload(getPool(), token);
  }

  /** Runs fn inside a real transaction, rolling back on any rejection. */
  async transaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
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
    await resetWorkspace(getPool(), workspaceId);
    return this.read(workspaceId);
  }
}

export function createRepository(): Repository {
  return new PostgresRepository();
}
