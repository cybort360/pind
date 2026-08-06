import type {
  Activity, AppState, Client, Comment, Decision, Milestone,
  Notification, Project, Revision, WorkspaceSettings,
} from '../../shared/types.js';
import { type Queryable, groupBy, iso, isoOrUndefined } from './rows.js';

const ACTIVITY_LIMIT = 100;
const NOTIFICATION_LIMIT = 50;

function toWorkspace(row: Record<string, any>): WorkspaceSettings {
  return {
    name: row.name,
    shortName: row.short_name,
    logoText: row.logo_text,
    accent: row.accent,
    surface: row.surface,
    portalHeadline: row.portal_headline,
    approvalDisclaimer: row.approval_disclaimer,
    emailFromName: row.email_from_name,
    requireClientName: row.require_client_name,
    allowDownloads: row.allow_downloads,
    showRevisionHistory: row.show_revision_history,
  };
}

function toClient(row: Record<string, any>): Client {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    avatar: row.avatar,
    activeProjects: row.active_projects,
    lastActiveAt: iso(row.last_active_at),
    status: row.status,
  };
}

function toRevision(row: Record<string, any>): Revision {
  return {
    id: row.id,
    label: row.label,
    version: row.version,
    fileName: row.file_name,
    fileUrl: row.file_url,
    thumbnail: row.thumbnail ?? undefined,
    kind: row.kind,
    uploadedAt: iso(row.uploaded_at),
    uploadedBy: row.uploaded_by,
    sizeLabel: row.size_label,
    note: row.note,
  };
}

function toComment(row: Record<string, any>): Comment {
  return {
    id: row.id,
    projectId: row.project_id,
    revisionId: row.revision_id,
    author: row.author,
    authorRole: row.author_role,
    body: row.body,
    status: row.status,
    createdAt: iso(row.created_at),
    resolvedAt: isoOrUndefined(row.resolved_at),
    reply: row.reply ?? undefined,
    x: row.x ?? undefined,
    y: row.y ?? undefined,
  };
}

function toMilestone(row: Record<string, any>): Milestone {
  return { id: row.id, title: row.title, dueAt: iso(row.due_at), status: row.status };
}

function toDecision(row: Record<string, any>): Decision {
  return {
    id: row.id,
    type: row.type,
    revisionId: row.revision_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    note: row.note,
    createdAt: iso(row.created_at),
    receiptCode: row.receipt_code,
  };
}

/** Builds Project objects for the given project rows, fetching their children. */
async function attachProjectChildren(
  db: Queryable,
  projectRows: Record<string, any>[],
): Promise<Project[]> {
  const ids = projectRows.map((row) => row.id);
  if (ids.length === 0) return [];

  const [milestones, revisions, comments, decisions, tokens] = await Promise.all([
    db.query(`SELECT * FROM milestones WHERE project_id = ANY($1) ORDER BY position ASC, id ASC`, [ids]),
    db.query(`SELECT * FROM revisions WHERE project_id = ANY($1) ORDER BY version ASC`, [ids]),
    db.query(`SELECT * FROM comments WHERE project_id = ANY($1) ORDER BY created_at DESC, id DESC`, [ids]),
    db.query(`SELECT * FROM decisions WHERE project_id = ANY($1) ORDER BY created_at DESC, id DESC`, [ids]),
    db.query(
      `SELECT project_id, token FROM review_tokens
       WHERE project_id = ANY($1) AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [ids],
    ),
  ]);

  const milestonesBy = groupBy(milestones.rows, (row) => row.project_id);
  const revisionsBy = groupBy(revisions.rows, (row) => row.project_id);
  const commentsBy = groupBy(comments.rows, (row) => row.project_id);
  const decisionsBy = groupBy(decisions.rows, (row) => row.project_id);
  const tokenBy = new Map(tokens.rows.map((row) => [row.project_id, row.token]));

  return projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    clientId: row.client_id,
    clientName: row.client_name,
    category: row.category,
    status: row.status,
    dueAt: iso(row.due_at),
    updatedAt: iso(row.updated_at),
    progress: row.progress,
    description: row.description,
    cover: row.cover,
    reviewToken: tokenBy.get(row.id) ?? '',
    budgetLabel: row.budget_label,
    owner: row.owner,
    revisions: (revisionsBy.get(row.id) ?? []).map(toRevision),
    comments: (commentsBy.get(row.id) ?? []).map(toComment),
    milestones: (milestonesBy.get(row.id) ?? []).map(toMilestone),
    decisions: (decisionsBy.get(row.id) ?? []).map(toDecision),
  }));
}

/** Assembles the whole workspace in the AppState shape the client expects. */
export async function readAppState(db: Queryable, workspaceId: string): Promise<AppState | null> {
  const workspace = await db.query(`SELECT * FROM workspaces WHERE id = $1`, [workspaceId]);
  if (workspace.rowCount === 0) return null;

  const [clients, projects, activities, notifications] = await Promise.all([
    db.query(
      `SELECT c.*, (
         SELECT COUNT(*)::int FROM projects p
         WHERE p.client_id = c.id AND p.status <> 'approved'
       ) AS active_projects
       FROM clients c WHERE c.workspace_id = $1
       ORDER BY c.last_active_at DESC, c.id ASC`,
      [workspaceId],
    ),
    db.query(
      `SELECT p.*, c.company AS client_name FROM projects p
       JOIN clients c ON c.id = p.client_id
       WHERE p.workspace_id = $1 ORDER BY p.updated_at DESC, p.id ASC`,
      [workspaceId],
    ),
    db.query(
      `SELECT * FROM activities WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [workspaceId, ACTIVITY_LIMIT],
    ),
    db.query(
      `SELECT * FROM notifications WHERE workspace_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [workspaceId, NOTIFICATION_LIMIT],
    ),
  ]);

  return {
    schemaVersion: 1,
    workspace: toWorkspace(workspace.rows[0]),
    // Overwritten by the caller with live environment flags.
    integrations: { database: true, email: false, cloudinary: false, slack: false },
    clients: clients.rows.map(toClient),
    projects: await attachProjectChildren(db, projects.rows),
    activities: activities.rows.map((row): Activity => ({
      id: row.id,
      type: row.type,
      title: row.title,
      detail: row.detail,
      actor: row.actor,
      projectId: row.project_id ?? undefined,
      createdAt: iso(row.created_at),
    })),
    notifications: notifications.rows.map((row): Notification => ({
      id: row.id,
      title: row.title,
      body: row.body,
      read: row.read,
      projectId: row.project_id ?? undefined,
      createdAt: iso(row.created_at),
    })),
  };
}

export { attachProjectChildren, toWorkspace, toClient };
