import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { DEMO_WORKSPACE_ID, seedState } from '../server/seed-data';
import { seedWorkspace } from '../server/db/seed';
import { truncateAll, withTestDatabase } from './helpers/db';

describe('seed workspace', () => {
  it('contains realistic states for the first-run demo', () => {
    expect(seedState.projects.length).toBeGreaterThanOrEqual(4);
    expect(seedState.clients.length).toBeGreaterThanOrEqual(3);
    expect(seedState.projects.some((project) => project.status === 'approved')).toBe(true);
    expect(seedState.projects.some((project) => project.status === 'changes-requested')).toBe(true);
    expect(seedState.projects.some((project) => project.comments.some((comment) => comment.x !== undefined))).toBe(true);
  });

  it('uses unique review tokens', () => {
    const tokens = seedState.projects.map((project) => project.reviewToken);
    expect(new Set(tokens).size).toBe(tokens.length);
  });


  it('keeps client project counters aligned with non-approved work', () => {
    for (const client of seedState.clients) {
      const activeProjects = seedState.projects.filter(
        (project) => project.clientId === client.id && project.status !== 'approved',
      ).length;
      expect(client.activeProjects).toBe(activeProjects);
    }
  });

  it('keeps decisions attached to existing revisions', () => {
    for (const project of seedState.projects) {
      const revisionIds = new Set(project.revisions.map((revision) => revision.id));
      for (const decision of project.decisions) {
        expect(revisionIds.has(decision.revisionId)).toBe(true);
      }
    }
  });
});

describe('relational seed', () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = await withTestDatabase(); await truncateAll(pool); });
  afterAll(async () => { await pool.end(); });

  async function counts() {
    const tables = ['workspaces', 'clients', 'projects', 'milestones', 'revisions', 'comments', 'decisions', 'review_tokens', 'activities', 'notifications'];
    const entries = await Promise.all(tables.map(async (table) => {
      const result = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM ${table}`);
      return [table, result.rows[0].count] as const;
    }));
    return Object.fromEntries(entries);
  }

  it('inserts the Northstar workspace on first run', async () => {
    const result = await seedWorkspace(pool);
    expect(result.inserted).toBe(true);
    const after = await counts();
    expect(after.workspaces).toBe(1);
    expect(after.clients).toBe(4);
    expect(after.projects).toBe(4);
    expect(after.review_tokens).toBe(4);
  });

  it('does not duplicate when seeded repeatedly', async () => {
    const before = await counts();
    await seedWorkspace(pool);
    await seedWorkspace(pool);
    expect(await counts()).toEqual(before);
  });

  it('links every decision to a revision of the same project', async () => {
    const result = await pool.query<{ bad: number }>(`
      SELECT COUNT(*)::int AS bad FROM decisions d
      JOIN revisions r ON r.id = d.revision_id
      WHERE r.project_id <> d.project_id
    `);
    expect(result.rows[0].bad).toBe(0);
  });

  it('gives every project exactly one active review token', async () => {
    const result = await pool.query<{ project_id: string; count: number }>(`
      SELECT project_id, COUNT(*)::int AS count FROM review_tokens
      WHERE revoked_at IS NULL GROUP BY project_id
    `);
    expect(result.rows).toHaveLength(4);
    for (const row of result.rows) expect(row.count).toBe(1);
  });
});
