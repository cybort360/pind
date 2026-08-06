import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { readAppState } from '../server/db/assemble';
import { seedWorkspace } from '../server/db/seed';
import { DEMO_WORKSPACE_ID } from '../server/seed-data';
import { truncateAll, withTestDatabase } from './helpers/db';

let pool: pg.Pool;

beforeAll(async () => {
  pool = await withTestDatabase();
  await truncateAll(pool);
  await seedWorkspace(pool);
});
afterAll(async () => { await pool.end(); });

describe('readAppState', () => {
  it('returns null for an unknown workspace', async () => {
    expect(await readAppState(pool, 'workspace-missing')).toBeNull();
  });

  it('assembles the full workspace with nested project children', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    expect(state.workspace.name).toBe('Northstar Creative');
    expect(state.clients).toHaveLength(4);
    expect(state.projects).toHaveLength(4);

    const ember = state.projects.find((project) => project.id === 'project-ember-packaging')!;
    expect(ember.revisions).toHaveLength(3);
    expect(ember.revisions.map((revision) => revision.version)).toEqual([1, 2, 3]);
    expect(ember.milestones.length).toBeGreaterThan(0);
    expect(ember.reviewToken).toBe('ember-summer-7k9qA4mT8vR2xP6cN1');
  });

  it('derives clientName from the joined client company', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    const ember = state.projects.find((project) => project.id === 'project-ember-packaging')!;
    expect(ember.clientName).toBe('Ember Coffee');
  });

  it('derives activeProjects from non-approved project counts', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    for (const client of state.clients) {
      const expected = state.projects.filter(
        (project) => project.clientId === client.id && project.status !== 'approved',
      ).length;
      expect(client.activeProjects).toBe(expected);
    }
  });

  it('emits ISO-8601 strings, never Date objects', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    expect(typeof state.projects[0].updatedAt).toBe('string');
    expect(state.projects[0].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof state.activities[0].createdAt).toBe('string');
  });

  it('rejects a duplicate client email with a unique violation', async () => {
    await expect(
      pool.query(
        `INSERT INTO clients (id, workspace_id, name, company, email, avatar, last_active_at, status)
         VALUES ('client-dupe',$1,'Copy','Copy Co','DARA@ember.example','CC',NOW(),'active')`,
        [DEMO_WORKSPACE_ID],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('orders clients by last_active_at descending, not created_at', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    expect(state.clients.map((client) => client.id)).toEqual([
      'client-ember', 'client-loom', 'client-field', 'client-sonder',
    ]);
  });

  it('orders comments newest-first, with a stable tiebreak for same-timestamp comments', async () => {
    const state = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    const ember = state.projects.find((project) => project.id === 'project-ember-packaging')!;
    // comment-ember-1 and comment-ember-2 share created_at; id DESC keeps
    // comment-ember-2 first. comment-ember-3 is newest overall.
    expect(ember.comments.map((comment) => comment.id)).toEqual([
      'comment-ember-3', 'comment-ember-2', 'comment-ember-1',
    ]);
  });

  it('returns identically-ordered arrays across repeated calls (regression guard for unspecified tie order)', async () => {
    const first = (await readAppState(pool, DEMO_WORKSPACE_ID))!;
    const second = (await readAppState(pool, DEMO_WORKSPACE_ID))!;

    expect(first.clients.map((client) => client.id)).toEqual(second.clients.map((client) => client.id));
    expect(first.projects.map((project) => project.id)).toEqual(second.projects.map((project) => project.id));
    expect(first.activities.map((activity) => activity.id)).toEqual(
      second.activities.map((activity) => activity.id),
    );
    expect(first.notifications.map((notification) => notification.id)).toEqual(
      second.notifications.map((notification) => notification.id),
    );
    for (let i = 0; i < first.projects.length; i++) {
      expect(first.projects[i].comments.map((comment) => comment.id)).toEqual(
        second.projects[i].comments.map((comment) => comment.id),
      );
    }
  });
});
