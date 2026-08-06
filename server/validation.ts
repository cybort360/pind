import { z } from 'zod';


export const createClientSchema = z.object({
  name: z.string().min(2).max(80),
  company: z.string().min(2).max(100),
  email: z.string().email(),
});

export const createProjectSchema = z.object({
  name: z.string().min(3).max(80),
  clientId: z.string().min(1),
  category: z.string().min(2).max(40),
  description: z.string().min(8).max(300),
  dueAt: z.string().datetime(),
  budgetLabel: z.string().max(30).default('Not set'),
});

export const commentSchema = z.object({
  revisionId: z.string().min(1),
  author: z.string().min(2).max(80),
  body: z.string().min(2).max(500),
  authorRole: z.enum(['client', 'studio']).default('client'),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
});

export const decisionSchema = z.object({
  type: z.enum(['approved', 'changes-requested']),
  revisionId: z.string().min(1),
  clientName: z.string().min(2).max(80),
  clientEmail: z.string().email(),
  note: z.string().max(500).default(''),
});

export const settingsSchema = z.object({
  name: z.string().min(2).max(80),
  shortName: z.string().min(1).max(30),
  logoText: z.string().min(1).max(3),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  surface: z.enum(['warm', 'cool', 'paper']),
  portalHeadline: z.string().min(10).max(160),
  approvalDisclaimer: z.string().min(10).max(300),
  emailFromName: z.string().min(2).max(80),
  requireClientName: z.boolean(),
  allowDownloads: z.boolean(),
  showRevisionHistory: z.boolean(),
});

export const inviteSchema = z.object({
  email: z.string().email(),
  message: z.string().max(500).optional().default(''),
});
