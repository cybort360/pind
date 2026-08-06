import 'dotenv/config';
import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { nanoid } from 'nanoid';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  commentSchema,
  createClientSchema,
  createProjectSchema,
  decisionSchema,
  inviteSchema,
  settingsSchema,
} from './validation.js';
import { createRepository } from './repository.js';
import { integrationFlags, notifySlack, sendEmail, uploadToCloudinary } from './integrations.js';
import type { Activity, AppState, Notification, Project, ReviewPayload, Revision } from '../shared/types.js';

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
// In production Express owns the public port (Replit injects PORT) and serves
// the built client. In development Vite owns the public port and proxies here,
// so the API listens privately on API_PORT instead. See vite.config.ts.
const port = isProduction
  ? Number(process.env.PORT ?? 5000)
  : Number(process.env.API_PORT ?? 3001);
const repository = createRepository();
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

await fs.mkdir(uploadsDir, { recursive: true });

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

let writeQueue: Promise<void> = Promise.resolve();

async function updateState(mutator: (draft: AppState) => void | Promise<void>): Promise<AppState> {
  let result!: AppState;
  const operation = writeQueue.then(async () => {
    const state = await repository.read();
    state.integrations = integrationFlags(repository.mode);
    await mutator(state);
    await repository.write(state);
    result = state;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  await operation;
  return result;
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

function addActivity(state: AppState, activity: Omit<Activity, 'id' | 'createdAt'>) {
  state.activities.unshift({ id: `activity-${nanoid(8)}`, createdAt: nowIso(), ...activity });
  state.activities = state.activities.slice(0, 100);
}

function addNotification(state: AppState, notification: Omit<Notification, 'id' | 'createdAt' | 'read'>) {
  state.notifications.unshift({
    id: `notification-${nanoid(8)}`,
    createdAt: nowIso(),
    read: false,
    ...notification,
  });
  state.notifications = state.notifications.slice(0, 50);
}

function touchClient(state: AppState, project: Project) {
  const client = state.clients.find((item) => item.id === project.clientId);
  if (client) {
    client.lastActiveAt = nowIso();
    client.status = 'active';
  }
  return client;
}

function syncClientProjectCount(state: AppState, project: Project, previousStatus: Project['status']) {
  const client = touchClient(state, project);
  if (!client) return;
  if (previousStatus !== 'approved' && project.status === 'approved') {
    client.activeProjects = Math.max(0, client.activeProjects - 1);
  } else if (previousStatus === 'approved' && project.status !== 'approved') {
    client.activeProjects += 1;
  }
}

function findProject(state: AppState, id: string): Project {
  const project = state.projects.find((item) => item.id === id);
  if (!project) {
    const error = new Error('Project not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return project;
}

function findReviewProject(state: AppState, token: string): Project {
  const project = state.projects.find((item) => item.reviewToken === token);
  if (!project) {
    const error = new Error('Review link not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return project;
}

function toReviewPayload(state: AppState, token: string): ReviewPayload {
  const project = findReviewProject(state, token);
  return {
    project,
    workspace: state.workspace,
    client: state.clients.find((item) => item.id === project.clientId),
  };
}

function appUrl(req?: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  return `http://localhost:${port}`;
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

app.get('/api/health', route(async (_req, res) => {
  const state = await repository.read();
  res.json({
    ok: true,
    app: 'Pind',
    mode: repository.mode,
    projects: state.projects.length,
    integrations: integrationFlags(repository.mode),
  });
}));

app.get('/api/bootstrap', route(async (_req, res) => {
  const state = await repository.read();
  state.integrations = integrationFlags(repository.mode);
  res.json({ state, meta: { repository: repository.mode, generatedAt: nowIso() } });
}));

app.get('/api/review/:token', route(async (req, res) => {
  const state = await repository.read();
  res.json(toReviewPayload(state, req.params.token));
}));

app.post('/api/review/:token/comments', route(async (req, res) => {
  const input = commentSchema.parse(req.body);
  const state = await updateState((draft) => {
    const project = findReviewProject(draft, req.params.token);
    const revision = project.revisions.find((item) => item.id === input.revisionId);
    if (!revision) {
      const error = new Error('Revision not found') as Error & { status?: number };
      error.status = 400;
      throw error;
    }
    project.comments.unshift({
      id: `comment-${nanoid(8)}`,
      projectId: project.id,
      revisionId: revision.id,
      author: input.author,
      authorRole: 'client',
      body: input.body,
      status: 'open',
      createdAt: nowIso(),
      x: input.x,
      y: input.y,
    });
    project.updatedAt = nowIso();
    project.status = 'in-review';
    touchClient(draft, project);
    addActivity(draft, {
      type: 'comment',
      title: `New comment on ${project.name}`,
      detail: input.body,
      actor: input.author,
      projectId: project.id,
    });
    addNotification(draft, {
      title: 'New client feedback',
      body: `${input.author} commented on ${revision.label}.`,
      projectId: project.id,
    });
  });
  res.status(201).json(toReviewPayload(state, req.params.token));
}));

app.post('/api/review/:token/decision', route(async (req, res) => {
  const input = decisionSchema.parse(req.body);
  let projectName = '';
  const state = await updateState((draft) => {
    const project = findReviewProject(draft, req.params.token);
    const revision = project.revisions.find((item) => item.id === input.revisionId);
    if (!revision) {
      const error = new Error('Revision not found') as Error & { status?: number };
      error.status = 400;
      throw error;
    }
    projectName = project.name;
    const previousStatus = project.status;
    const receiptCode = `PND-${project.clientName.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase()}-${nanoid(6).toUpperCase()}`;
    project.decisions.unshift({
      id: `decision-${nanoid(8)}`,
      type: input.type,
      revisionId: revision.id,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      note: input.note,
      createdAt: nowIso(),
      receiptCode,
    });
    project.status = input.type;
    project.progress = input.type === 'approved' ? 100 : Math.max(45, project.progress - 5);
    project.updatedAt = nowIso();
    syncClientProjectCount(draft, project, previousStatus);
    if (input.type === 'approved') {
      const current = project.milestones.find((item) => item.status === 'current');
      if (current) current.status = 'complete';
      const upcoming = project.milestones.find((item) => item.status === 'upcoming');
      if (upcoming) upcoming.status = 'current';
    }
    addActivity(draft, {
      type: 'approval',
      title: input.type === 'approved' ? `${project.name} approved` : `Changes requested on ${project.name}`,
      detail: input.note || `Decision captured for revision ${revision.version}.`,
      actor: input.clientName,
      projectId: project.id,
    });
    addNotification(draft, {
      title: input.type === 'approved' ? 'Client approval captured' : 'Client requested changes',
      body: `${input.clientName} responded to ${revision.label}.`,
      projectId: project.id,
    });
  });

  void notifySlack(
    input.type === 'approved'
      ? `✅ ${projectName} was approved by ${input.clientName}.`
      : `↩️ ${input.clientName} requested changes on ${projectName}.`,
  ).catch(console.error);

  res.status(201).json(toReviewPayload(state, req.params.token));
}));

app.post('/api/clients', route(async (req, res) => {
  const input = createClientSchema.parse(req.body);
  const state = await updateState((draft) => {
    const duplicate = draft.clients.some((client) => client.email.toLowerCase() === input.email.toLowerCase());
    if (duplicate) {
      const error = new Error('A client with this email already exists') as Error & { status?: number };
      error.status = 409;
      throw error;
    }
    const avatar = input.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
    draft.clients.unshift({
      id: `client-${nanoid(10)}`,
      name: input.name,
      company: input.company,
      email: input.email.toLowerCase(),
      avatar,
      activeProjects: 0,
      lastActiveAt: nowIso(),
      status: 'active',
    });
    addActivity(draft, {
      type: 'project',
      title: `${input.company} added`,
      detail: `${input.name} was added to the client directory.`,
      actor: 'Maya Okeke',
    });
  });
  res.status(201).json(state);
}));

app.post('/api/projects', route(async (req, res) => {
  const input = createProjectSchema.parse(req.body);
  const state = await updateState((draft) => {
    const client = draft.clients.find((item) => item.id === input.clientId);
    if (!client) {
      const error = new Error('Client not found') as Error & { status?: number };
      error.status = 400;
      throw error;
    }

    const id = `project-${nanoid(10)}`;
    const project: Project = {
      id,
      name: input.name,
      clientId: client.id,
      clientName: client.company,
      category: input.category,
      status: 'draft',
      dueAt: input.dueAt,
      updatedAt: nowIso(),
      progress: 12,
      description: input.description,
      cover: '/assets/field.svg',
      reviewToken: `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 22)}-${nanoid(18)}`,
      budgetLabel: input.budgetLabel,
      owner: 'Maya Okeke',
      revisions: [],
      comments: [],
      milestones: [
        { id: `milestone-${nanoid(6)}`, title: 'Project kickoff', dueAt: nowIso(), status: 'complete' },
        { id: `milestone-${nanoid(6)}`, title: 'First review', dueAt: input.dueAt, status: 'current' },
      ],
      decisions: [],
    };
    draft.projects.unshift(project);
    client.activeProjects += 1;
    addActivity(draft, {
      type: 'project',
      title: `${project.name} created`,
      detail: `A new ${project.category.toLowerCase()} project was created for ${project.clientName}.`,
      actor: project.owner,
      projectId: project.id,
    });
  });
  res.status(201).json(state);
}));

app.post('/api/projects/:id/comments', route(async (req, res) => {
  const input = commentSchema.parse(req.body);
  const state = await updateState((draft) => {
    const project = findProject(draft, req.params.id);
    const revision = project.revisions.find((item) => item.id === input.revisionId);
    if (!revision) {
      const error = new Error('Revision not found') as Error & { status?: number };
      error.status = 400;
      throw error;
    }
    project.comments.unshift({
      id: `comment-${nanoid(8)}`,
      projectId: project.id,
      revisionId: revision.id,
      author: input.author,
      authorRole: input.authorRole,
      body: input.body,
      status: 'open',
      createdAt: nowIso(),
      x: input.x,
      y: input.y,
    });
    project.updatedAt = nowIso();
    if (input.authorRole === 'client') project.status = 'in-review';
    addActivity(draft, {
      type: 'comment',
      title: `New comment on ${project.name}`,
      detail: input.body,
      actor: input.author,
      projectId: project.id,
    });
    if (input.authorRole === 'client') {
      touchClient(draft, project);
      addNotification(draft, {
        title: 'New client feedback',
        body: `${input.author} commented on ${revision.label}.`,
        projectId: project.id,
      });
    }
  });
  res.status(201).json(state);
}));

app.patch('/api/comments/:id/resolve', route(async (req, res) => {
  const reply = typeof req.body?.reply === 'string' ? req.body.reply.slice(0, 400) : '';
  const state = await updateState((draft) => {
    let found = false;
    for (const project of draft.projects) {
      const comment = project.comments.find((item) => item.id === req.params.id);
      if (!comment) continue;
      comment.status = 'resolved';
      comment.resolvedAt = nowIso();
      comment.reply = reply || comment.reply;
      project.updatedAt = nowIso();
      addActivity(draft, {
        type: 'resolve',
        title: 'Feedback resolved',
        detail: comment.body,
        actor: 'Maya Okeke',
        projectId: project.id,
      });
      found = true;
      break;
    }
    if (!found) {
      const error = new Error('Comment not found') as Error & { status?: number };
      error.status = 404;
      throw error;
    }
  });
  res.json(state);
}));

app.post('/api/projects/:id/revisions', upload.single('file'), route(async (req, res) => {
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

  const state = await updateState((draft) => {
    const project = findProject(draft, projectId);
    const version = Math.max(0, ...project.revisions.map((item) => item.version)) + 1;
    const kind: Revision['kind'] = req.file!.mimetype.startsWith('image/')
      ? 'image'
      : req.file!.mimetype.startsWith('video/')
        ? 'video'
        : req.file!.mimetype.includes('pdf')
          ? 'pdf'
          : 'file';
    project.revisions.push({
      id: `revision-${nanoid(8)}`,
      label,
      version,
      fileName: req.file!.originalname,
      fileUrl,
      thumbnail: kind === 'image' ? fileUrl : undefined,
      kind,
      uploadedAt: nowIso(),
      uploadedBy: 'Maya Okeke',
      sizeLabel: `${(req.file!.size / (1024 * 1024)).toFixed(1)} MB`,
      note,
    });
    project.updatedAt = nowIso();
    project.status = 'in-review';
    project.progress = Math.min(95, project.progress + 12);
    addActivity(draft, {
      type: 'upload',
      title: `Revision ${version} uploaded`,
      detail: `${req.file!.originalname} was stored with ${provider}.`,
      actor: 'Maya Okeke',
      projectId: project.id,
    });
    addNotification(draft, {
      title: 'Revision ready to share',
      body: `${project.name} now has revision ${version}.`,
      projectId: project.id,
    });
  });

  res.status(201).json(state);
}));

app.post('/api/projects/:id/decision', route(async (req, res) => {
  const input = decisionSchema.parse(req.body);
  let projectName = '';
  const state = await updateState((draft) => {
    const project = findProject(draft, req.params.id);
    const revision = project.revisions.find((item) => item.id === input.revisionId);
    if (!revision) {
      const error = new Error('Revision not found') as Error & { status?: number };
      error.status = 400;
      throw error;
    }
    projectName = project.name;
    const previousStatus = project.status;
    const receiptCode = `PND-${project.clientName.replace(/[^A-Za-z]/g, '').slice(0, 6).toUpperCase()}-${nanoid(6).toUpperCase()}`;
    project.decisions.unshift({
      id: `decision-${nanoid(8)}`,
      type: input.type,
      revisionId: input.revisionId,
      clientName: input.clientName,
      clientEmail: input.clientEmail,
      note: input.note,
      createdAt: nowIso(),
      receiptCode,
    });
    project.status = input.type;
    project.progress = input.type === 'approved' ? 100 : Math.max(45, project.progress - 5);
    project.updatedAt = nowIso();
    syncClientProjectCount(draft, project, previousStatus);
    if (input.type === 'approved') {
      const current = project.milestones.find((item) => item.status === 'current');
      if (current) current.status = 'complete';
      const upcoming = project.milestones.find((item) => item.status === 'upcoming');
      if (upcoming) upcoming.status = 'current';
    }
    addActivity(draft, {
      type: 'approval',
      title: input.type === 'approved' ? `${project.name} approved` : `Changes requested on ${project.name}`,
      detail: input.note || `Decision captured for revision ${revision.version}.`,
      actor: input.clientName,
      projectId: project.id,
    });
    addNotification(draft, {
      title: input.type === 'approved' ? 'Client approval captured' : 'Client requested changes',
      body: `${input.clientName} responded to ${revision.label}.`,
      projectId: project.id,
    });
  });

  void notifySlack(
    input.type === 'approved'
      ? `✅ ${projectName} was approved by ${input.clientName}.`
      : `↩️ ${input.clientName} requested changes on ${projectName}.`,
  ).catch(console.error);

  res.status(201).json(state);
}));

app.post('/api/projects/:id/invite', route(async (req, res) => {
  const input = inviteSchema.parse(req.body);
  const state = await repository.read();
  const project = findProject(state, req.params.id);
  const reviewUrl = `${appUrl(req)}/review/${project.reviewToken}`;
  const safeWorkspaceName = escapeHtml(state.workspace.name);
  const safeProjectName = escapeHtml(project.name);
  const safeMessage = escapeHtml(input.message || `Please review the latest revision of ${project.name}.`);
  const result = await sendEmail({
    to: input.email,
    subject: `Review ${project.name.replace(/[\r\n]/g, ' ')} in Pind`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1f2421">
        <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#66706a">${safeWorkspaceName}</div>
        <h1 style="font-size:28px;line-height:1.2;margin:18px 0 12px">Your review is ready</h1>
        <p style="line-height:1.6;color:#59615c">${safeMessage}</p>
        <a href="${reviewUrl}" style="display:inline-block;margin-top:18px;background:${state.workspace.accent};color:white;text-decoration:none;padding:13px 18px;border-radius:10px">Open review</a>
        <p style="margin-top:28px;font-size:12px;color:#8a918d">This secure link is scoped to ${safeProjectName}.</p>
      </div>`,
  });

  const updated = await updateState((draft) => {
    addActivity(draft, {
      type: 'invite',
      title: `Review invitation ${result.sent ? 'sent' : 'prepared'}`,
      detail: `${input.email} was invited to review ${project.name}.`,
      actor: 'Maya Okeke',
      projectId: project.id,
    });
  });

  res.json({ state: updated, sent: result.sent, reviewUrl });
}));

app.patch('/api/settings', route(async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const state = await updateState((draft) => {
    draft.workspace = input;
    addActivity(draft, {
      type: 'project',
      title: 'Workspace branding updated',
      detail: `The client portal now uses ${input.name} branding.`,
      actor: 'Maya Okeke',
    });
  });
  res.json(state);
}));

app.patch('/api/notifications/:id/read', route(async (req, res) => {
  const state = await updateState((draft) => {
    const notification = draft.notifications.find((item) => item.id === req.params.id);
    if (notification) notification.read = true;
  });
  res.json(state);
}));

app.post('/api/demo/reset', route(async (_req, res) => {
  const state = await repository.reset();
  state.integrations = integrationFlags(repository.mode);
  await repository.write(state);
  res.json(state);
}));

// Unmatched API paths must stay JSON. Without this the SPA fallback below
// would answer them with index.html and a 200, which the client would silently
// parse as an empty payload.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

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

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  if (error && typeof error === 'object' && 'issues' in error) {
    return res.status(400).json({ error: 'Invalid request', details: error });
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
  res.status(Number.isFinite(status) ? status : 500).json({ error: message });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Pind server running on http://0.0.0.0:${port} (${repository.mode})`);
});
