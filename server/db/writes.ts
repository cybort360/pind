import type pg from 'pg';
import { nanoid } from 'nanoid';
import type { Activity, Notification, Project } from '../../shared/types.js';

export async function addActivity(
  tx: pg.PoolClient,
  input: Omit<Activity, 'id' | 'createdAt'> & { workspaceId: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO activities (id, workspace_id, project_id, type, title, detail, actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [`activity-${nanoid(8)}`, input.workspaceId, input.projectId ?? null, input.type,
     input.title, input.detail, input.actor],
  );
}

export async function addNotification(
  tx: pg.PoolClient,
  input: Omit<Notification, 'id' | 'createdAt' | 'read'> & { workspaceId: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO notifications (id, workspace_id, project_id, title, body)
     VALUES ($1,$2,$3,$4,$5)`,
    [`notification-${nanoid(8)}`, input.workspaceId, input.projectId ?? null, input.title, input.body],
  );
}

/** Marks a client active, mirroring the old touchClient() behaviour. */
export async function touchClient(tx: pg.PoolClient, clientId: string): Promise<void> {
  await tx.query(
    `UPDATE clients SET last_active_at = NOW(), status = 'active' WHERE id = $1`,
    [clientId],
  );
}

/** Loads a project for update, throwing a 404 the error middleware understands. */
export async function requireProject(
  tx: pg.PoolClient,
  projectId: string,
): Promise<{ id: string; workspace_id: string; client_id: string; name: string; status: Project['status']; progress: number }> {
  const result = await tx.query(
    `SELECT id, workspace_id, client_id, name, status, progress FROM projects WHERE id = $1 FOR UPDATE`,
    [projectId],
  );
  if (result.rowCount === 0) {
    const error = new Error('Project not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

/** Loads a project by review token, locking it for the duration of the write. */
export async function requireProjectByToken(
  tx: pg.PoolClient,
  token: string,
): Promise<{ id: string; workspace_id: string; client_id: string; name: string; status: Project['status']; progress: number }> {
  const result = await tx.query(
    `SELECT p.id, p.workspace_id, p.client_id, p.name, p.status, p.progress
     FROM review_tokens t JOIN projects p ON p.id = t.project_id
     WHERE t.token = $1 AND t.revoked_at IS NULL
       AND (t.expires_at IS NULL OR t.expires_at > NOW())
     FOR UPDATE OF p`,
    [token],
  );
  if (result.rowCount === 0) {
    const error = new Error('Review link not found') as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

/** Ensures a revision belongs to the project, throwing 400 like the old code. */
export async function requireRevision(
  tx: pg.PoolClient,
  projectId: string,
  revisionId: string,
): Promise<{ id: string; label: string; version: number }> {
  const result = await tx.query(
    `SELECT id, label, version FROM revisions WHERE id = $1 AND project_id = $2`,
    [revisionId, projectId],
  );
  if (result.rowCount === 0) {
    const error = new Error('Revision not found') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return result.rows[0];
}
