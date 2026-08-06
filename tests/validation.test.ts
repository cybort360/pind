import { describe, expect, it } from 'vitest';
import { commentSchema, createProjectSchema, decisionSchema, settingsSchema } from '../server/validation';

describe('API validation', () => {
  it('accepts a valid pinned comment', () => {
    const result = commentSchema.safeParse({
      revisionId: 'rev-1',
      author: 'Dara Okafor',
      authorRole: 'client',
      body: 'Increase the legal line slightly.',
      x: 42,
      y: 68,
    });
    expect(result.success).toBe(true);
  });

  it('rejects pin coordinates outside the artwork', () => {
    expect(commentSchema.safeParse({ revisionId: 'rev-1', author: 'Dara', body: 'Move this.', x: 140, y: 20 }).success).toBe(false);
  });

  it('requires decisions to identify a revision and reviewer', () => {
    expect(decisionSchema.safeParse({ type: 'approved', revisionId: '', clientName: 'Dara', clientEmail: 'bad', note: '' }).success).toBe(false);
  });

  it('validates project and white-label settings contracts', () => {
    expect(createProjectSchema.safeParse({ name: 'A', clientId: '', category: '', description: '', dueAt: 'tomorrow' }).success).toBe(false);
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });
});
