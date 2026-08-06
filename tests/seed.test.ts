import { describe, expect, it } from 'vitest';
import { seedState } from '../server/seed-data';

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
