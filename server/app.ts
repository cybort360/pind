import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { customAlphabet, nanoid } from 'nanoid';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import {
  commentSchema,
  createClientSchema,
  createProjectSchema,
  decisionSchema,
  inviteSchema,
  loginSchema,
  setupSchema,
  settingsSchema,
} from './validation.js';
import { createRepository, type Repository } from './repository.js';
import { runMigrations } from './db/migrate.js';
import { seedWorkspace } from './db/seed.js';
import {
  addActivity,
  addNotification,
  requireProject,
  requireProjectByToken,
  requireRevision,
  touchClient,
} from './db/writes.js';
import { DEMO_WORKSPACE_ID } from './seed-data.js';
import { integrationFlags, notifySlack, sendEmail, uploadToCloudinary } from './integrations.js';
import {
  clearSessionCookie,
  hashPassword,
  newSessionToken,
  setSessionCookie,
  sha256,
  verifyPassword,
  SESSION_COOKIE_NAME,
  sessionTtlMs,
} from './auth.js';
import { APP_CONFIG, approvalWording, deliverableKinds, featureFlags, projectCategories } from '../shared/config.js';
import type { AppState, DecisionType, Project, Revision } from '../shared/types.js';

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export interface CreateAppOptions {
  repository?: Repository;
}

/**
 * Builds the Express application. The repository is injectable so tests can run
 * the full HTTP surface against the test database without binding the real port.
 */
export function createApp(options: CreateAppOptions = {}): { app: express.Express; repository: Repository } {
  const repository = options.repository ?? createRepository();
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      const blockedMimeTypes = new Set([
        'text/html',
        'image/svg+xml',
        'application/javascript',
        'text/javascript',
        'application/x-msdownload',
      ]);
      const blockedExtension = /\.(?:html?|svg|js|mjs|cjs|exe|dll|cmd|bat|sh)$/i.test(file.originalname);
      if (blockedMimeTypes.has(file.mimetype) || blockedExtension) {
        const error = new Error('This file type is not allowed') as Error & { status?: number };
        error.status = 400;
        callback(error);
        return;
      }
      callback(null, true);
    },
  });
  const uploadsDir = path.resolve(process.cwd(), 'uploads');

  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(compression());
  const configuredOrigin = process.env.APP_URL?.replace(/\/$/, '');
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || !configuredOrigin || origin === configuredOrigin);
    },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(uploadsDir));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  /** Runs a mutation in a transaction, then returns the freshly-read state. */
  async function mutate(workspaceId: string, fn: (tx: pg.PoolClient) => Promise<void>): Promise<AppState> {
    await repository.transaction(fn);
    const state = await repository.read(workspaceId);
    state.integrations = integrationFlags(repository.mode);
    return state;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character] ?? character);
  }

  /**
   * Receipt codes are read aloud and retyped by clients, so the suffix uses an
   * explicit uppercase alphanumeric alphabet. nanoid's default alphabet includes
   * `-` and `_`, which produced codes like `PND-EMBERC--VTVLR`.
   */
  const receiptSuffix = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 6);

  /** Applies a client decision. Shared by the studio and public review routes. */
  async function applyDecision(
    tx: pg.PoolClient,
    project: { id: string; workspace_id: string; client_id: string; name: string; status: Project['status'] },
    input: { type: DecisionType; revisionId: string; clientName: string; clientEmail: string; note: string },
  ): Promise<void> {
    const revision = await requireRevision(tx, project.id, input.revisionId);
    const company = await tx.query<{ company: string }>(`SELECT company FROM clients WHERE id = $1`, [project.client_id]);
    const receiptCode = `PND-${(company.rows[0]?.company ?? '').replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase()}-${receiptSuffix()}`;

    await tx.query(
      `INSERT INTO decisions (id, project_id, revision_id, type, client_name, client_email, note, receipt_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [`decision-${nanoid(8)}`, project.id, revision.id, input.type, input.clientName,
       input.clientEmail, input.note, receiptCode],
    );

    await tx.query(
      `UPDATE projects SET status = $2, updated_at = NOW(),
         progress = CASE WHEN $2 = 'approved' THEN 100 ELSE GREATEST(45, progress - 5) END
       WHERE id = $1`,
      [project.id, input.type],
    );
    await touchClient(tx, project.client_id);

    if (input.type === 'approved') {
      // Advance the milestone chain: current -> complete, first upcoming -> current.
      await tx.query(
        `UPDATE milestones SET status = 'complete'
         WHERE id = (SELECT id FROM milestones WHERE project_id = $1 AND status = 'current'
                     ORDER BY position LIMIT 1)`,
        [project.id],
      );
      await tx.query(
        `UPDATE milestones SET status = 'current'
         WHERE id = (SELECT id FROM milestones WHERE project_id = $1 AND status = 'upcoming'
                     ORDER BY position LIMIT 1)`,
        [project.id],
      );
    }

    await addActivity(tx, {
      workspaceId: project.workspace_id, projectId: project.id, type: 'approval',
      title: input.type === 'approved' ? `${project.name} approved` : `Changes requested on ${project.name}`,
      detail: input.note || `Decision captured for revision ${revision.version}.`,
      actor: input.clientName,
    });
    await addNotification(tx, {
      workspaceId: project.workspace_id, projectId: project.id,
      title: input.type === 'approved' ? 'Client approval captured' : 'Client requested changes',
      body: `${input.clientName} responded to ${revision.label}.`,
    });
  }

  function appUrl(req?: Request) {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
    if (req) return `${req.protocol}://${req.get('host')}`;
    return `http://localhost:${Number(process.env.PORT ?? 5000)}`;
  }

  /**
   * Express 4 does not forward rejections from async handlers to the error
   * middleware, so a thrown 404 or a Zod parse failure becomes an unhandled
   * rejection and terminates the process. Every async route goes through this
   * wrapper so failures reach the error handler at the bottom of this file.
   */
  function route(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => {
      handler(req, res, next).catch(next);
    };
  }

  /**
   * Reads the session cookie, resolves it to a live session, and pins
   * `res.locals.workspaceId` for the rest of the request. Any mutation route
   * behind this middleware is scoped to the authenticated workspace.
   */
  async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
      if (!token) {
        const error = new Error('Authentication required') as Error & { status?: number };
        error.status = 401;
        throw error;
      }
      const result = await repository.pool.query(
        `SELECT s.id AS session_id, s.workspace_id, s.user_id, s.kind, u.first_name AS user_name
         FROM sessions s
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
        [sha256(token)],
      );
      if (result.rowCount === 0) {
        const error = new Error('Session expired or invalid') as Error & { status?: number };
        error.status = 401;
        throw error;
      }
      const session = result.rows[0];
      res.locals.session = session;
      res.locals.workspaceId = session.workspace_id;
      res.locals.userName = session.user_name ?? 'Workspace owner';
      void repository.pool.query(`UPDATE sessions SET last_used_at = NOW() WHERE id = $1`, [session.session_id])
        .catch((error) => console.error('Could not record session use', error));
      next();
    } catch (error) {
      next(error);
    }
  }

  /** True when any workspace has a password-protected owner user. */
  async function isConfigured(): Promise<boolean> {
    const result = await repository.pool.query<{ configured: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM users WHERE password_hash IS NOT NULL
       ) AS configured`,
    );
    return result.rows[0].configured;
  }

  async function currentSession(req: Request) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (!token) return null;
    const result = await repository.pool.query(
      `SELECT s.workspace_id, s.user_id, s.kind, u.first_name AS user_name
       FROM sessions s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [sha256(token)],
    );
    return result.rowCount === 0 ? null : result.rows[0];
  }

  // ---------------------------------------------------------------- public ---

  app.get('/api/health', route(async (_req, res) => {
    res.json({
      ok: true,
      app: APP_CONFIG.name,
      mode: repository.mode,
      features: featureFlags(),
    });
  }));

  app.get('/api/config', route(async (_req, res) => {
    res.json({
      app: APP_CONFIG,
      projectCategories: projectCategories(),
      deliverableKinds: deliverableKinds(),
      approvalWording: approvalWording(),
      features: featureFlags(),
    });
  }));

  app.get('/api/auth/status', route(async (req, res) => {
    const session = await currentSession(req);
    res.json({
      configured: await isConfigured(),
      authenticated: Boolean(session),
      demo: session?.kind === 'demo',
    });
  }));

  app.post('/api/auth/setup', route(async (req, res) => {
    if (await isConfigured()) {
      const error = new Error('This workspace is already set up') as Error & { status?: number };
      error.status = 409;
      throw error;
    }
    const input = setupSchema.parse(req.body);
    const workspaceId = `workspace-${nanoid(10)}`;
    const userId = `user-${nanoid(10)}`;
    const token = newSessionToken();
    await repository.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO workspaces (id, name, short_name, logo_text, accent, surface,
           portal_headline, approval_disclaimer, email_from_name,
           require_client_name, allow_downloads, show_revision_history)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [workspaceId, input.name, input.shortName, input.logoText, input.accent, input.surface,
         input.portalHeadline, input.approvalDisclaimer, input.emailFromName,
         true, true, true],
      );
      await tx.query(
        `INSERT INTO users (id, workspace_id, email, first_name, role, password_hash)
         VALUES ($1,$2,$3,$4,'owner',$5)`,
        [userId, workspaceId, input.email.toLowerCase(), input.ownerName, hashPassword(input.ownerPassword)],
      );
      await tx.query(
        `INSERT INTO sessions (id, workspace_id, user_id, token_hash, kind, expires_at)
         VALUES ($1,$2,$3,$4,'password',NOW() + ($5 || ' days')::interval)`,
        [`session-${nanoid(8)}`, workspaceId, userId, sha256(token), String(Math.ceil(sessionTtlMs() / 86_400_000))],
      );
    });
    if (input.loadDemoData) {
      // Sample content is inserted after the workspace itself commits, using a
      // fresh connection, so the demo seed's own transaction is kept simple.
      await seedWorkspace(repository.pool, { workspaceId });
    }
    setSessionCookie(res, token);
    const state = await repository.read(workspaceId);
    state.integrations = integrationFlags(repository.mode);
    state.owner = { name: input.ownerName, email: input.email.toLowerCase() };
    res.status(201).json(state);
  }));

  app.post('/api/auth/login', route(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await repository.pool.query(
      `SELECT u.id, u.password_hash, u.first_name, u.workspace_id
       FROM users u WHERE lower(u.email) = lower($1)`,
      [input.email],
    );
    const user = result.rows[0];
    if (!user?.password_hash || !verifyPassword(input.password, user.password_hash)) {
      const error = new Error('Email or password is incorrect') as Error & { status?: number };
      error.status = 401;
      throw error;
    }
    const token = newSessionToken();
    await repository.pool.query(
      `INSERT INTO sessions (id, workspace_id, user_id, token_hash, kind, expires_at)
       VALUES ($1,$2,$3,$4,'password',NOW() + ($5 || ' days')::interval)`,
      [`session-${nanoid(8)}`, user.workspace_id, user.id, sha256(token), String(Math.ceil(sessionTtlMs() / 86_400_000))],
    );
    setSessionCookie(res, token);
    const state = await repository.read(user.workspace_id);
    state.integrations = integrationFlags(repository.mode);
    state.owner = { name: user.first_name, email: input.email.toLowerCase() };
    res.json(state);
  }));

  app.post('/api/auth/logout', route(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (token) {
      await repository.pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }));

  /** One-click demo: seeds the demo workspace (idempotently) and opens a demo session. */
  app.post('/api/auth/demo', route(async (req, res) => {
    await seedWorkspace(repository.pool);
    const token = newSessionToken();
    await repository.pool.query(
      `INSERT INTO sessions (id, workspace_id, user_id, token_hash, kind, expires_at)
       VALUES ($1,$2,NULL,$3,'demo',NOW() + ($4 || ' days')::interval)`,
      [`session-${nanoid(8)}`, DEMO_WORKSPACE_ID, sha256(token), String(Math.ceil(sessionTtlMs() / 86_400_000))],
    );
    setSessionCookie(res, token);
    const state = await repository.read(DEMO_WORKSPACE_ID);
    state.integrations = integrationFlags(repository.mode);
    state.owner = { name: 'Demo workspace', demo: true };
    res.status(201).json(state);
  }));

  app.get('/api/review/:token', route(async (req, res) => {
    const payload = await repository.readReviewPayload(req.params.token);
    if (!payload) {
      const error = new Error('Review link not found or expired') as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    res.json(payload);
  }));

  app.post('/api/review/:token/comments', route(async (req, res) => {
    const input = commentSchema.parse(req.body);
    await repository.transaction(async (tx) => {
      const project = await requireProjectByToken(tx, req.params.token);
      const revision = await requireRevision(tx, project.id, input.revisionId);
      await tx.query(
        `INSERT INTO comments (id, project_id, revision_id, author, author_role, body, status, x, y)
         VALUES ($1,$2,$3,$4,'client',$5,'open',$6,$7)`,
        [`comment-${nanoid(8)}`, project.id, revision.id, input.author, input.body,
         input.x ?? null, input.y ?? null],
      );
      await tx.query(`UPDATE projects SET updated_at = NOW(), status = 'in-review' WHERE id = $1`, [project.id]);
      await touchClient(tx, project.client_id);
      await addActivity(tx, {
        workspaceId: project.workspace_id, projectId: project.id, type: 'comment',
        title: `New comment on ${project.name}`, detail: input.body, actor: input.author,
      });
      await addNotification(tx, {
        workspaceId: project.workspace_id, projectId: project.id,
        title: 'New client feedback', body: `${input.author} commented on ${revision.label}.`,
      });
    });
    const payload = await repository.readReviewPayload(req.params.token);
    res.status(201).json(payload);
  }));

  app.post('/api/review/:token/decision', route(async (req, res) => {
    const input = decisionSchema.parse(req.body);
    let projectName = '';
    await repository.transaction(async (tx) => {
      const project = await requireProjectByToken(tx, req.params.token);
      projectName = project.name;
      await applyDecision(tx, project, input);
    });

    void notifySlack(
      input.type === 'approved'
        ? `✅ ${projectName} was approved by ${input.clientName}.`
        : `↩️ ${input.clientName} requested changes on ${projectName}.`,
    ).catch(console.error);

    res.status(201).json(await repository.readReviewPayload(req.params.token));
  }));

  // ------------------------------------------------------- studio (authed) ---

  app.get('/api/bootstrap', requireAuth, route(async (_req, res) => {
    const state = await repository.read(res.locals.workspaceId);
    state.integrations = integrationFlags(repository.mode);
    const session = res.locals.session;
    state.owner = {
      name: res.locals.userName,
      demo: session?.kind === 'demo',
    };
    res.json({ state, meta: { repository: repository.mode, generatedAt: nowIso() } });
  }));

  app.post('/api/clients', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const input = createClientSchema.parse(req.body);
    const state = await mutate(workspaceId, async (tx) => {
      const avatar = input.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
      // The UNIQUE (workspace_id, lower(email)) index enforces this; a 23505
      // is mapped to HTTP 409 by the error middleware.
      await tx.query(
        `INSERT INTO clients (id, workspace_id, name, company, email, avatar, status)
         VALUES ($1,$2,$3,$4,$5,$6,'active')`,
        [`client-${nanoid(10)}`, workspaceId, input.name, input.company, input.email.toLowerCase(), avatar],
      );
      await addActivity(tx, {
        workspaceId,
        type: 'project',
        title: `${input.company} added`,
        detail: `${input.name} was added to the client directory.`,
        actor: res.locals.userName,
      });
    });
    res.status(201).json(state);
  }));

  app.post('/api/projects', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const input = createProjectSchema.parse(req.body);
    const state = await mutate(workspaceId, async (tx) => {
      const client = await tx.query(`SELECT id, company FROM clients WHERE id = $1 AND workspace_id = $2`,
        [input.clientId, workspaceId]);
      if (client.rowCount === 0) {
        const error = new Error('Client not found') as Error & { status?: number };
        error.status = 400;
        throw error;
      }

      const id = `project-${nanoid(10)}`;
      await tx.query(
        `INSERT INTO projects (id, workspace_id, client_id, name, category, status, due_at,
           progress, description, cover, budget_label, owner)
         VALUES ($1,$2,$3,$4,$5,'draft',$6,12,$7,'/assets/field.svg',$8,$9)`,
        [id, workspaceId, input.clientId, input.name, input.category, input.dueAt,
         input.description, input.budgetLabel, res.locals.userName],
      );

      const token = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 22)}-${nanoid(18)}`;
      await tx.query(`INSERT INTO review_tokens (token, project_id) VALUES ($1,$2)`, [token, id]);

      await tx.query(
        `INSERT INTO milestones (id, project_id, title, due_at, status, position) VALUES
           ($1,$2,'Project kickoff',NOW(),'complete',0),
           ($3,$2,'First review',$4,'current',1)`,
        [`milestone-${nanoid(6)}`, id, `milestone-${nanoid(6)}`, input.dueAt],
      );

      await addActivity(tx, {
        workspaceId,
        projectId: id,
        type: 'project',
        title: `${input.name} created`,
        detail: `A new ${input.category.toLowerCase()} project was created for ${client.rows[0].company}.`,
        actor: res.locals.userName,
      });
    });
    res.status(201).json(state);
  }));

  app.post('/api/projects/:id/comments', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const input = commentSchema.parse(req.body);
    const state = await mutate(workspaceId, async (tx) => {
      const project = await requireProject(tx, req.params.id, workspaceId);
      const revision = await requireRevision(tx, project.id, input.revisionId);
      await tx.query(
        `INSERT INTO comments (id, project_id, revision_id, author, author_role, body, status, x, y)
         VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8)`,
        [`comment-${nanoid(8)}`, project.id, revision.id, input.author, input.authorRole,
         input.body, input.x ?? null, input.y ?? null],
      );
      if (input.authorRole === 'client') {
        await tx.query(`UPDATE projects SET updated_at = NOW(), status = 'in-review' WHERE id = $1`, [project.id]);
        await touchClient(tx, project.client_id);
        await addNotification(tx, {
          workspaceId: project.workspace_id, projectId: project.id,
          title: 'New client feedback', body: `${input.author} commented on ${revision.label}.`,
        });
      } else {
        await tx.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [project.id]);
      }
      await addActivity(tx, {
        workspaceId: project.workspace_id, projectId: project.id, type: 'comment',
        title: `New comment on ${project.name}`, detail: input.body, actor: input.author,
      });
    });
    res.status(201).json(state);
  }));

  app.patch('/api/comments/:id/resolve', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const reply = typeof req.body?.reply === 'string' ? req.body.reply.slice(0, 400) : '';
    const state = await mutate(workspaceId, async (tx) => {
      const result = await tx.query(
        `UPDATE comments SET status = 'resolved', resolved_at = NOW(),
           reply = COALESCE(NULLIF($2,''), reply)
         WHERE id = $1
         RETURNING project_id, body`,
        [req.params.id, reply],
      );
      if (result.rowCount === 0) {
        const error = new Error('Comment not found') as Error & { status?: number };
        error.status = 404;
        throw error;
      }
      const { project_id: projectId, body } = result.rows[0];
      await tx.query(`UPDATE projects SET updated_at = NOW() WHERE id = $1`, [projectId]);
      await addActivity(tx, {
        workspaceId, projectId, type: 'resolve',
        title: 'Feedback resolved', detail: body, actor: res.locals.userName,
      });
    });
    res.json(state);
  }));

  app.post('/api/projects/:id/revisions', requireAuth, upload.single('file'), route(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
    const projectId = req.params.id;
    const label = String(req.body.label || 'New revision').slice(0, 80);
    const note = String(req.body.note || '').slice(0, 500);

    let fileUrl = '';
    let provider: 'cloudinary' | 'local' = 'local';
    const cloudResult = await uploadToCloudinary(req.file.buffer, req.file.originalname);
    if (cloudResult) {
      fileUrl = cloudResult.url;
      provider = cloudResult.provider;
    } else {
      const safeName = `${Date.now()}-${nanoid(6)}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      await fs.writeFile(path.join(uploadsDir, safeName), req.file.buffer);
      fileUrl = `/uploads/${safeName}`;
    }

    const state = await mutate(res.locals.workspaceId, async (tx) => {
      const project = await requireProject(tx, projectId, res.locals.workspaceId);
      // UNIQUE (project_id, version) makes this safe under concurrent uploads;
      // a collision surfaces as 23505 rather than two rows sharing a version.
      const next = await tx.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM revisions WHERE project_id = $1`,
        [projectId],
      );
      const version = next.rows[0].version;
      const kind: Revision['kind'] = req.file!.mimetype.startsWith('image/')
        ? 'image'
        : req.file!.mimetype.startsWith('video/')
          ? 'video'
          : req.file!.mimetype.includes('pdf') ? 'pdf' : 'file';

      await tx.query(
        `INSERT INTO revisions (id, project_id, label, version, file_name, file_url, thumbnail,
           kind, uploaded_by, size_label, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [`revision-${nanoid(8)}`, projectId, label, version, req.file!.originalname, fileUrl,
         kind === 'image' ? fileUrl : null, kind,
         res.locals.userName, `${(req.file!.size / (1024 * 1024)).toFixed(1)} MB`, note],
      );
      await tx.query(
        `UPDATE projects SET updated_at = NOW(), status = 'in-review',
           progress = LEAST(95, progress + 12) WHERE id = $1`,
        [projectId],
      );
      await addActivity(tx, {
        workspaceId: project.workspace_id, projectId, type: 'upload',
        title: `Revision ${version} uploaded`,
        detail: `${req.file!.originalname} was stored with ${provider}.`, actor: res.locals.userName,
      });
      await addNotification(tx, {
        workspaceId: project.workspace_id, projectId,
        title: 'Revision ready to share', body: `${project.name} now has revision ${version}.`,
      });
    });

    res.status(201).json(state);
  }));

  app.post('/api/projects/:id/decision', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const input = decisionSchema.parse(req.body);
    let projectName = '';
    const state = await mutate(workspaceId, async (tx) => {
      const project = await requireProject(tx, req.params.id, workspaceId);
      projectName = project.name;
      await applyDecision(tx, project, input);
    });

    void notifySlack(
      input.type === 'approved'
        ? `✅ ${projectName} was approved by ${input.clientName}.`
        : `↩️ ${input.clientName} requested changes on ${projectName}.`,
    ).catch(console.error);

    res.status(201).json(state);
  }));

  app.post('/api/projects/:id/invite', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const input = inviteSchema.parse(req.body);
    const state = await repository.read(workspaceId);
    const project = state.projects.find((item) => item.id === req.params.id);
    if (!project) {
      const error = new Error('Project not found') as Error & { status?: number };
      error.status = 404;
      throw error;
    }
    const reviewUrl = `${appUrl(req)}/review/${project.reviewToken}`;
    const safeWorkspaceName = escapeHtml(state.workspace.name);
    const safeProjectName = escapeHtml(project.name);
    const safeMessage = escapeHtml(input.message || `Please review the latest revision of ${project.name}.`);
    const result = await sendEmail({
      to: input.email,
      subject: `Review ${project.name.replace(/[\r\n]/g, ' ')} in ${APP_CONFIG.name}`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1f2421">
          <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#66706a">${safeWorkspaceName}</div>
          <h1 style="font-size:28px;line-height:1.2;margin:18px 0 12px">Your review is ready</h1>
          <p style="line-height:1.6;color:#59615c">${safeMessage}</p>
          <a href="${reviewUrl}" style="display:inline-block;margin-top:18px;background:${state.workspace.accent};color:white;text-decoration:none;padding:13px 18px;border-radius:10px">Open review</a>
          <p style="margin-top:28px;font-size:12px;color:#8a918d">This secure link is scoped to ${safeProjectName}.</p>
        </div>`,
    });

    const updated = await mutate(workspaceId, async (tx) => {
      await addActivity(tx, {
        workspaceId, projectId: project.id, type: 'invite',
        title: `Review invitation ${result.sent ? 'sent' : 'prepared'}`,
        detail: `${input.email} was invited to review ${project.name}.`, actor: res.locals.userName,
      });
    });

    res.json({ state: updated, sent: result.sent, reviewUrl });
  }));

  app.patch('/api/settings', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const input = settingsSchema.parse(req.body);
    const state = await mutate(workspaceId, async (tx) => {
      await tx.query(
        `UPDATE workspaces SET name=$2, short_name=$3, logo_text=$4, accent=$5, surface=$6,
           portal_headline=$7, approval_disclaimer=$8, email_from_name=$9,
           require_client_name=$10, allow_downloads=$11, show_revision_history=$12, updated_at=NOW()
         WHERE id = $1`,
        [workspaceId, input.name, input.shortName, input.logoText, input.accent, input.surface,
         input.portalHeadline, input.approvalDisclaimer, input.emailFromName,
         input.requireClientName, input.allowDownloads, input.showRevisionHistory],
      );
      await addActivity(tx, {
        workspaceId, type: 'project', title: 'Workspace branding updated',
        detail: `The client portal now uses ${input.name} branding.`, actor: res.locals.userName,
      });
    });
    res.json(state);
  }));

  app.patch('/api/notifications/:id/read', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const state = await mutate(workspaceId, async (tx) => {
      await tx.query(`UPDATE notifications SET read = TRUE WHERE id = $1 AND workspace_id = $2`,
        [req.params.id, workspaceId]);
    });
    res.json(state);
  }));

  app.post('/api/projects/:id/review-token/rotate', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const state = await mutate(workspaceId, async (tx) => {
      const project = await requireProject(tx, req.params.id, workspaceId);
      await tx.query(`UPDATE review_tokens SET revoked_at = NOW() WHERE project_id = $1 AND revoked_at IS NULL`, [project.id]);
      const token = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 22)}-${nanoid(18)}`;
      await tx.query(`INSERT INTO review_tokens (token, project_id) VALUES ($1,$2)`, [token, project.id]);
    });
    res.json(state);
  }));

  app.post('/api/projects/:id/review-token/revoke', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const state = await mutate(workspaceId, async (tx) => {
      const project = await requireProject(tx, req.params.id, workspaceId);
      await tx.query(`UPDATE review_tokens SET revoked_at = NOW() WHERE project_id = $1 AND revoked_at IS NULL`, [project.id]);
    });
    res.json(state);
  }));

  app.post('/api/demo/reset', requireAuth, route(async (req, res) => {
    const workspaceId = res.locals.workspaceId;
    const state = await repository.reset(workspaceId);
    state.integrations = integrationFlags(repository.mode);
    res.json(state);
  }));

  // Unmatched API paths must stay JSON. Without this the SPA fallback below
  // would answer them with index.html and a 200, which the client would silently
  // parse as an empty payload.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    if (error && typeof error === 'object' && 'issues' in error) {
      return res.status(400).json({ error: 'Invalid request', details: error });
    }
    // Postgres unique violations are conflicts, not server faults. The only one
    // a client can trigger deliberately is the duplicate-email index, which the
    // old in-memory check answered with the same 409 and message.
    if (error && typeof error === 'object' && (error as { code?: string }).code === '23505') {
      const constraint = (error as { constraint?: string }).constraint;
      return res.status(409).json({
        error: constraint === 'clients_workspace_email_key'
          ? 'A client with this email already exists'
          : 'That record already exists',
      });
    }
    // A foreign-key or check violation means the request pointed at something
    // that does not exist, or carried a value the schema rejects. Both are the
    // caller's mistake, so they are 400s rather than 500s.
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code?: string }).code);
      if (code === '23503') {
        return res.status(400).json({ error: 'Referenced record does not exist' });
      }
      if (code === '23514') {
        return res.status(400).json({ error: 'Invalid value for one of the fields' });
      }
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
    res.status(Number.isFinite(status) ? status : 500).json({ error: message });
  });

  return { app, repository };
}

/**
 * Connect, migrate, and seed before the first request can arrive. A missing or
 * unreachable database exits non-zero without binding the port, so Replit
 * restarts the deployment instead of serving an application that would fail
 * every request.
 */
export async function start(): Promise<void> {
  const { app } = createApp();
  const isProduction = process.env.NODE_ENV === 'production';
  const port = isProduction
    ? Number(process.env.PORT ?? 5000)
    : Number(process.env.API_PORT ?? 3001);

  await fs.mkdir(path.resolve(process.cwd(), 'uploads'), { recursive: true });
  try {
    const { getPool } = await import('./db/pool.js');
    const pool = getPool();
    await runMigrations(pool);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (isProduction) {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexFile = path.join(distDir, 'index.html');
    if (!existsSync(indexFile)) {
      console.error('Missing dist/index.html — run "npm run build" before "npm start".');
      process.exit(1);
    }
    app.use(express.static(distDir));
    // Client-side routes (/app/projects/:id, /review/:token, …) must survive a
    // direct load and a refresh, so every remaining GET returns the SPA shell.
    app.get('*', (_req, res) => res.sendFile(indexFile));
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Pind server running on http://0.0.0.0:${port} (postgres)`);
  });
}
