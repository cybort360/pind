import pg from 'pg';
import type { AppState } from '../../shared/types.js';
import { DEMO_WORKSPACE_ID, buildSeed } from '../seed-data.js';

/**
 * Writes the demo workspace. Every statement is ON CONFLICT DO NOTHING keyed
 * on the seed's stable natural IDs, so repeated runs insert nothing.
 */
export async function seedWorkspace(
  pool: pg.Pool,
  options: { workspaceId?: string; state?: AppState } = {},
): Promise<{ inserted: boolean }> {
  const workspaceId = options.workspaceId ?? DEMO_WORKSPACE_ID;
  const state = options.state ?? buildSeed();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const workspace = await client.query(
      `INSERT INTO workspaces (id, name, short_name, logo_text, accent, surface,
         portal_headline, approval_disclaimer, email_from_name,
         require_client_name, allow_downloads, show_revision_history)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [workspaceId, state.workspace.name, state.workspace.shortName, state.workspace.logoText,
       state.workspace.accent, state.workspace.surface, state.workspace.portalHeadline,
       state.workspace.approvalDisclaimer, state.workspace.emailFromName,
       state.workspace.requireClientName, state.workspace.allowDownloads,
       state.workspace.showRevisionHistory],
    );

    for (const item of state.clients) {
      await client.query(
        `INSERT INTO clients (id, workspace_id, name, company, email, avatar, last_active_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [item.id, workspaceId, item.name, item.company, item.email, item.avatar, item.lastActiveAt, item.status],
      );
    }

    for (const project of state.projects) {
      await client.query(
        `INSERT INTO projects (id, workspace_id, client_id, name, category, status, due_at,
           updated_at, progress, description, cover, budget_label, owner)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [project.id, workspaceId, project.clientId, project.name, project.category, project.status,
         project.dueAt, project.updatedAt, project.progress, project.description, project.cover,
         project.budgetLabel, project.owner],
      );

      await client.query(
        `INSERT INTO review_tokens (token, project_id) VALUES ($1,$2) ON CONFLICT (token) DO NOTHING`,
        [project.reviewToken, project.id],
      );

      for (const [index, milestone] of project.milestones.entries()) {
        await client.query(
          `INSERT INTO milestones (id, project_id, title, due_at, status, position)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
          [milestone.id, project.id, milestone.title, milestone.dueAt, milestone.status, index],
        );
      }

      for (const revision of project.revisions) {
        await client.query(
          `INSERT INTO revisions (id, project_id, label, version, file_name, file_url, thumbnail,
             kind, uploaded_at, uploaded_by, size_label, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [revision.id, project.id, revision.label, revision.version, revision.fileName,
           revision.fileUrl, revision.thumbnail ?? null, revision.kind, revision.uploadedAt,
           revision.uploadedBy, revision.sizeLabel, revision.note],
        );
      }

      for (const comment of project.comments) {
        await client.query(
          `INSERT INTO comments (id, project_id, revision_id, author, author_role, body, status,
             created_at, resolved_at, reply, x, y)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [comment.id, project.id, comment.revisionId, comment.author, comment.authorRole,
           comment.body, comment.status, comment.createdAt, comment.resolvedAt ?? null,
           comment.reply ?? null, comment.x ?? null, comment.y ?? null],
        );
      }

      for (const decision of project.decisions) {
        await client.query(
          `INSERT INTO decisions (id, project_id, revision_id, type, client_name, client_email,
             note, created_at, receipt_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
          [decision.id, project.id, decision.revisionId, decision.type, decision.clientName,
           decision.clientEmail, decision.note, decision.createdAt, decision.receiptCode],
        );
      }
    }

    for (const activity of state.activities) {
      await client.query(
        `INSERT INTO activities (id, workspace_id, project_id, type, title, detail, actor, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [activity.id, workspaceId, activity.projectId ?? null, activity.type, activity.title,
         activity.detail, activity.actor, activity.createdAt],
      );
    }

    for (const notification of state.notifications) {
      await client.query(
        `INSERT INTO notifications (id, workspace_id, project_id, title, body, read, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [notification.id, workspaceId, notification.projectId ?? null, notification.title,
         notification.body, notification.read, notification.createdAt],
      );
    }

    await client.query('COMMIT');
    return { inserted: (workspace.rowCount ?? 0) > 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Deletes one workspace and re-seeds it. Cascades remove all children. */
export async function resetWorkspace(pool: pg.Pool, workspaceId = DEMO_WORKSPACE_ID): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await seedWorkspace(pool, { workspaceId });
}
