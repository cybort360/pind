import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { AppState, ReviewPayload } from '../shared/types';
import { createApp } from '../server/app';
import { seedWorkspace } from '../server/db/seed';
import { DEMO_WORKSPACE_ID } from '../server/seed-data';
import { createRepository } from '../server/repository';
import { truncateAll, withTestDatabase } from './helpers/db';

let pool: pg.Pool;
let server: Server;
let base: string;
let repository: ReturnType<typeof createApp>['repository'];

const COOKIE_HEADER = 'cookie';

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, init);
}

function cookie(res: Response): string {
  return res.headers.get('set-cookie')?.split(';')[0] ?? '';
}

async function setupWorkspace(workspace: {
  name?: string; shortName?: string; logoText?: string; accent?: string; surface?: string;
  portalHeadline?: string; approvalDisclaimer?: string; emailFromName?: string;
  ownerName?: string; email?: string; ownerPassword?: string; loadDemoData?: boolean;
} = {}, loadDemoData = false) {
  const res = await request('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: workspace.name ?? 'Test Studio',
      shortName: workspace.shortName ?? 'Test',
      logoText: 'T',
      accent: '#2f5d50',
      surface: 'paper',
      portalHeadline: workspace.portalHeadline ?? 'Review the work. Leave clear feedback. Approve with confidence.',
      approvalDisclaimer: workspace.approvalDisclaimer ?? 'Approval confirms this revision is accepted as final.',
      emailFromName: workspace.emailFromName ?? 'Studio',
      ownerName: workspace.ownerName ?? 'Alex Rivera',
      email: workspace.email ?? 'alex@example.com',
      ownerPassword: workspace.ownerPassword ?? 'correct horse battery',
      loadDemoData,
    }),
  });
  return { response: res, cookie: cookie(res), state: await res.clone().json() as AppState };
}

beforeAll(async () => {
  pool = await withTestDatabase();
  await truncateAll(pool);
  repository = createApp({ repository: createRepository(pool) }).repository;
  const { app } = createApp({ repository });
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe('health and config', () => {
  it('reports a healthy app with feature flags', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.app).toBe('Pind');
    expect(body.features).toHaveProperty('cloudinary');
    expect(body.features).toHaveProperty('resend');
    expect(body.features).toHaveProperty('slack');
  });

  it('serves the central config with categories and kinds', async () => {
    const res = await request('/api/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.app.name).toBe('Pind');
    expect(body.projectCategories.length).toBeGreaterThanOrEqual(4);
    expect(body.deliverableKinds.length).toBeGreaterThanOrEqual(4);
    expect(body.approvalWording).toHaveProperty('approvedTitle');
  });
});

describe('first-run setup', () => {
  it('rejects a weak owner password', async () => {
    // beforeAll truncates the database, so this runs in the unconfigured state.
    const res = await request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zzz', shortName: 'Z', logoText: 'Z', accent: '#000000', surface: 'paper', portalHeadline: 'abcdefghij', approvalDisclaimer: 'abcdefghij', emailFromName: 'Z', ownerName: 'W', email: 'w@example.com', ownerPassword: 'short', loadDemoData: false }),
    });
    expect(res.status).toBe(400);
  });

  it('starts unconfigured and reports so via auth status', async () => {
    const res = await request('/api/auth/status');
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(body.authenticated).toBe(false);
  });

  it('creates a workspace, signs in, and returns workspace state', async () => {
    const { response, state, cookie } = await setupWorkspace();
    expect(response.status).toBe(201);
    expect(state.workspace.name).toBe('Test Studio');
    expect(state.owner?.name).toBe('Alex Rivera');
    expect(state.owner?.demo).toBeFalsy();
    expect(cookie).toContain('pind_session');

    const status = await (await request('/api/auth/status', { headers: { cookie } })).json();
    expect(status.configured).toBe(true);
    expect(status.authenticated).toBe(true);
  });

  it('refuses a second setup after the workspace is configured', async () => {
    const res = await request('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', shortName: 'X', logoText: 'X', accent: '#000000', surface: 'paper', portalHeadline: 'abcdefghij', approvalDisclaimer: 'abcdefghij', emailFromName: 'X', ownerName: 'Y', email: 'y@example.com', ownerPassword: 'password123', loadDemoData: false }),
    });
    expect(res.status).toBe(409);
  });
});

describe('login and logout', () => {
  it('rejects unknown credentials', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong wrong wrong' }),
    });
    expect(res.status).toBe(401);
  });

  it('authenticates the owner and issues a fresh session cookie', async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex@example.com', password: 'correct horse battery' }),
    });
    expect(login.status).toBe(200);
    const state = await login.json() as AppState;
    expect(state.owner?.name).toBe('Alex Rivera');
    const authCookie = cookie(login);
    expect(authCookie).toBeTruthy();

    const boot = await request('/api/bootstrap', { headers: { cookie: authCookie } });
    expect(boot.status).toBe(200);
  });

  it('guards the studio behind authentication', async () => {
    const res = await request('/api/bootstrap');
    expect(res.status).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alex@example.com', password: 'correct horse battery' }),
    });
    const authCookie = cookie(login);
    const out = await request('/api/auth/logout', { method: 'POST', headers: { cookie: authCookie } });
    expect(out.status).toBe(200);
    const after = await request('/api/bootstrap', { headers: { cookie: authCookie } });
    expect(after.status).toBe(401);
  });
});

describe('demo mode', () => {
  it('opens the idempotent seeded demo workspace', async () => {
    await truncateAll(pool);
    const demo = await request('/api/auth/demo', { method: 'POST' });
    expect(demo.status).toBe(201);
    const state = await demo.json() as AppState;
    expect(state.workspace.name).toBe('Northstar Creative');
    expect(state.owner?.demo).toBe(true);
    expect(state.projects.length).toBeGreaterThan(0);

    const demo2 = await request('/api/auth/demo', { method: 'POST' });
    expect(demo2.status).toBe(201);
    expect((await demo2.json() as AppState).projects.length).toBe(((state.projects.length)));
  });

  it('resets the demo workspace to its original seed state', async () => {
    const demo = await request('/api/auth/demo', { method: 'POST' });
    const authCookie = cookie(demo);
    const state = await demo.json() as AppState;

    const firstProject = state.projects[0];
    await request(`/api/projects/${firstProject.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: authCookie },
      body: JSON.stringify({ revisionId: firstProject.revisions[0].id, author: 'Studio', authorRole: 'studio', body: 'A throwaway comment from the test.' }),
    });
    const before = await (await request('/api/bootstrap', { headers: { cookie: authCookie } })).json() as { state: AppState };
    const beforeComments = before.state.projects[0].comments.length;

    const reset = await request('/api/demo/reset', { method: 'POST', headers: { cookie: authCookie } });
    expect(reset.status).toBe(200);
    const resetState = await reset.json() as AppState;
    const resetComments = resetState.projects.find((project) => project.id === firstProject.id)!.comments.length;
    expect(resetComments).toBeLessThan(beforeComments);
  });
});

describe('workspace isolation', () => {
  it('never leaks one workspace clients into another', async () => {
    await truncateAll(pool);
    const a = await setupWorkspace({ name: 'Studio A', shortName: 'A', email: 'a@example.com', ownerName: 'Ava Owner' });
    const aCookie = a.cookie;
    await request('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: aCookie },
      body: JSON.stringify({ name: 'Only in A', company: 'Acme', email: 'acme@example.com' }),
    });

    // Tenant B is the demo workspace, a genuinely separate Postgres workspace_id.
    const b = await request('/api/auth/demo', { method: 'POST' });
    expect(b.status).toBe(201);
    const bCookie = cookie(b);
    const bBoot = await (await request('/api/bootstrap', { headers: { cookie: bCookie } })).json() as { state: AppState };
    expect(bBoot.state.clients.every((client) => client.company !== 'Acme')).toBe(true);

    const aBoot = await (await request('/api/bootstrap', { headers: { cookie: aCookie } })).json() as { state: AppState };
    expect(aBoot.state.clients).toHaveLength(1);
    expect(aBoot.state.clients[0].company).toBe('Acme');
  });
});

describe('projects and review tokens', () => {
  it('creates a client and project with a stable review token, then leaves the public review open', async () => {
    await truncateAll(pool);
    const owner = await setupWorkspace();
    const authCookie = owner.cookie;

    const clientRes = await request('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: authCookie },
      body: JSON.stringify({ name: 'Priya Nair', company: 'Terracotta', email: 'priya@terracotta.example' }),
    });
    expect(clientRes.status).toBe(201);
    const clientState = await clientRes.json() as AppState;
    const clientId = clientState.clients[0].id;

    const projectRes = await request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: authCookie },
      body: JSON.stringify({ name: 'Summer Brand Refresh', clientId, category: 'brand-packaging', description: 'Refresh the seasonal packaging for the summer line.', dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }),
    });
    expect(projectRes.status).toBe(201);
    const projectState = await projectRes.json() as AppState;
    const project = projectState.projects.find((p: any) => p.clientId === clientId)!;
    expect(project.reviewToken).toBeTruthy();

    // The public review link is reachable with no session cookie.
    const review = await request(`/api/review/${project.reviewToken}`);
    expect(review.status).toBe(200);
    const payload = await review.json();
    expect(payload.project.id).toBe(project.id);
    expect(payload.project).not.toHaveProperty('otherStuff');

    // Rotating revokes the old token immediately.
    await request(`/api/projects/${project.id}/review-token/rotate`, { method: 'POST', headers: { cookie: authCookie } });
    const gone = await request(`/api/review/${project.reviewToken}`);
    expect(gone.status).toBe(404);
  });

  it('blocks a client decision on an expired or revoked link via 404', async () => {
    await truncateAll(pool);
    const demo = await request('/api/auth/demo', { method: 'POST' });
    const authCookie = cookie(demo);
    const state = await demo.json() as AppState;
    const project = state.projects[0];
    const token = project.reviewToken;

    // Revoke it as an owner, then a client cannot approve.
    await request(`/api/projects/${project.id}/review-token/revoke`, { method: 'POST', headers: { cookie: authCookie } });
    const res = await request(`/api/review/${token}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'approved', revisionId: project.revisions[0].id, clientName: 'Client', clientEmail: 'client@example.com' }),
    });
    expect(res.status).toBe(404);
  });

  it('routes studio mutations to the owning workspace only', async () => {
    await truncateAll(pool);
    const a = await setupWorkspace({ email: 'isolation-a@example.com', ownerName: 'Ava Owner' });
    const aCookie = a.cookie;

    const clientA = await (await request('/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: aCookie },
      body: JSON.stringify({ name: 'A Name', company: 'A Co', email: 'a@a.example' }),
    })).json() as AppState;
    const aProject = await (await request('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: aCookie },
      body: JSON.stringify({ name: 'A Project', clientId: clientA.clients[0].id, category: 'campaign', description: 'A project created by tenant A.', dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }),
    })).json() as AppState;

    // Tenant B (the demo workspace) must not be able to mutate A's project.
    const b = await request('/api/auth/demo', { method: 'POST' });
    const bCookie = cookie(b);
    const aProj = aProject.projects[0];
    const forbidden = await request(`/api/projects/${aProj.id}/review-token/rotate`, {
      method: 'POST', headers: { cookie: bCookie },
    });
    expect(forbidden.status).toBe(404);
  });
});