/**
 * Central template configuration.
 *
 * Everything a remixer would want to change about the product — the name, the
 * editable project categories, the deliverable types, the approval wording,
 * and runtime feature flags — lives here so it can be adjusted in one place
 * instead of being scattered across pages and routes.
 *
 * The static defaults are shared by the server (seeding, validation,
 * `/api/config`) and the client (forms, filters, copy). Server-side env
 * overrides are applied by `server/integrations.ts` and the `/api/config`
 * endpoint so a deployment can customise behaviour without editing code.
 */

export const APP_CONFIG = {
  name: 'Pind',
  tagline: 'Put feedback where the work is.',
  description:
    'Pind gives creative teams one calm place to share revisions, pin precise feedback, capture approval, and hand off the final work.',
} as const;

export interface ProjectCategory {
  id: string;
  label: string;
}

const DEFAULT_PROJECT_CATEGORIES: ProjectCategory[] = [
  { id: 'brand-packaging', label: 'Brand & Packaging' },
  { id: 'campaign', label: 'Campaign' },
  { id: 'web-design', label: 'Web Design' },
  { id: 'video', label: 'Video' },
  { id: 'print', label: 'Print' },
  { id: 'product-design', label: 'Product Design' },
];

export interface DeliverableKind {
  id: 'image' | 'pdf' | 'video' | 'link' | 'file';
  label: string;
}

const DEFAULT_DELIVERABLE_KINDS: DeliverableKind[] = [
  { id: 'image', label: 'Image' },
  { id: 'pdf', label: 'PDF' },
  { id: 'video', label: 'Video' },
  { id: 'link', label: 'Link' },
  { id: 'file', label: 'File' },
];

export interface ApprovalWording {
  approvedTitle: string;
  approvedDetail: string;
  changesTitle: string;
  changesDetail: string;
}

const DEFAULT_APPROVAL_WORDING: ApprovalWording = {
  approvedTitle: 'Approve revision',
  approvedDetail: 'Accepted as final for the milestone shown.',
  changesTitle: 'Request changes',
  changesDetail: 'Summarise the remaining work before the next revision.',
};

export interface FeatureFlags {
  /** Per-workspace portal policy; surfaced here as the deploy-time defaults. */
  requireClientName: boolean;
  allowDownloads: boolean;
  showRevisionHistory: boolean;
  /** Optional capability switches. */
  cloudinary: boolean;
  resend: boolean;
  slack: boolean;
}

export function projectCategories(): ProjectCategory[] {
  return DEFAULT_PROJECT_CATEGORIES;
}

export function deliverableKinds(): DeliverableKind[] {
  return DEFAULT_DELIVERABLE_KINDS;
}

export function approvalWording(): ApprovalWording {
  return DEFAULT_APPROVAL_WORDING;
}

/**
 * Deploy-time feature flags. Env is only readable server-side; the client
 * receives the same flags from `GET /api/config`.
 */
export function featureFlags(env: Record<string, string | undefined> = process.env): FeatureFlags {
  return {
    requireClientName: env.FEATURE_REQUIRE_CLIENT_NAME !== 'false',
    allowDownloads: env.FEATURE_ALLOW_DOWNLOADS !== 'false',
    showRevisionHistory: env.FEATURE_SHOW_REVISION_HISTORY !== 'false',
    cloudinary: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET),
    resend: Boolean(env.RESEND_API_KEY),
    slack: Boolean(env.SLACK_WEBHOOK_URL),
  };
}
