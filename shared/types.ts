export type ProjectStatus = 'in-review' | 'changes-requested' | 'approved' | 'draft';
export type CommentStatus = 'open' | 'resolved';
export type DeliverableKind = 'image' | 'pdf' | 'video' | 'link' | 'file';
export type DecisionType = 'approved' | 'changes-requested';

export interface WorkspaceSettings {
  name: string;
  shortName: string;
  logoText: string;
  accent: string;
  surface: 'warm' | 'cool' | 'paper';
  portalHeadline: string;
  approvalDisclaimer: string;
  emailFromName: string;
  requireClientName: boolean;
  allowDownloads: boolean;
  showRevisionHistory: boolean;
}

export interface IntegrationState {
  database: boolean;
  email: boolean;
  cloudinary: boolean;
  slack: boolean;
}

export interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  avatar: string;
  activeProjects: number;
  lastActiveAt: string;
  status: 'active' | 'invited' | 'archived';
}

export interface Comment {
  id: string;
  projectId: string;
  revisionId: string;
  author: string;
  authorRole: 'client' | 'studio';
  body: string;
  status: CommentStatus;
  createdAt: string;
  resolvedAt?: string;
  x?: number;
  y?: number;
  reply?: string;
}

export interface Revision {
  id: string;
  label: string;
  version: number;
  fileName: string;
  fileUrl: string;
  kind: DeliverableKind;
  uploadedAt: string;
  uploadedBy: string;
  sizeLabel: string;
  note: string;
  thumbnail?: string;
}

export interface Milestone {
  id: string;
  title: string;
  dueAt: string;
  status: 'complete' | 'current' | 'upcoming';
}

export interface Decision {
  id: string;
  type: DecisionType;
  revisionId: string;
  clientName: string;
  clientEmail: string;
  note: string;
  createdAt: string;
  receiptCode: string;
}

export interface Project {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  category: string;
  status: ProjectStatus;
  dueAt: string;
  updatedAt: string;
  progress: number;
  description: string;
  cover: string;
  reviewToken: string;
  budgetLabel: string;
  owner: string;
  revisions: Revision[];
  comments: Comment[];
  milestones: Milestone[];
  decisions: Decision[];
}

export interface Activity {
  id: string;
  type: 'comment' | 'upload' | 'approval' | 'invite' | 'resolve' | 'project';
  title: string;
  detail: string;
  actor: string;
  projectId?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  projectId?: string;
}

export interface AppState {
  schemaVersion: number;
  workspace: WorkspaceSettings;
  integrations: IntegrationState;
  clients: Client[];
  projects: Project[];
  activities: Activity[];
  notifications: Notification[];
}

export interface DashboardMetrics {
  activeProjects: number;
  awaitingReview: number;
  approvedThisMonth: number;
  openComments: number;
  approvalRate: number;
}

export interface ReviewPayload {
  project: Project;
  workspace: WorkspaceSettings;
  client?: Client;
}
