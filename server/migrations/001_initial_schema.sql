-- Pind initial relational schema. Replaces the single-document JSONB store.
DROP TABLE IF EXISTS pind_app_state;

CREATE TABLE workspaces (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  short_name            TEXT NOT NULL,
  logo_text             TEXT NOT NULL,
  accent                TEXT NOT NULL CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),
  surface               TEXT NOT NULL CHECK (surface IN ('warm','cool','paper')),
  portal_headline       TEXT NOT NULL,
  approval_disclaimer   TEXT NOT NULL,
  email_from_name       TEXT NOT NULL,
  require_client_name   BOOLEAN NOT NULL DEFAULT TRUE,
  allow_downloads       BOOLEAN NOT NULL DEFAULT TRUE,
  show_revision_history BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email             TEXT,
  first_name        TEXT,
  last_name         TEXT,
  profile_image_url TEXT,
  role              TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','member')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_workspace_idx ON users (workspace_id);

CREATE TABLE clients (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  company        TEXT NOT NULL,
  email          TEXT NOT NULL,
  avatar         TEXT NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status         TEXT NOT NULL CHECK (status IN ('active','invited','archived')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX clients_workspace_email_key ON clients (workspace_id, lower(email));

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('in-review','changes-requested','approved','draft')),
  due_at       TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress     INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  description  TEXT NOT NULL,
  cover        TEXT NOT NULL,
  budget_label TEXT NOT NULL DEFAULT 'Not set',
  owner        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX projects_workspace_idx ON projects (workspace_id, updated_at DESC);
CREATE INDEX projects_client_idx ON projects (client_id);

CREATE TABLE milestones (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  due_at     TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('complete','current','upcoming')),
  position   INTEGER NOT NULL
);
CREATE INDEX milestones_project_idx ON milestones (project_id, position);

CREATE TABLE revisions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  version     INTEGER NOT NULL,
  file_name   TEXT NOT NULL,
  file_url    TEXT NOT NULL,
  thumbnail   TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('image','pdf','video','link','file')),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by TEXT NOT NULL,
  size_label  TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, version)
);
CREATE INDEX revisions_project_idx ON revisions (project_id, version);

CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('client','studio')),
  body        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('open','resolved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  reply       TEXT,
  x           REAL CHECK (x >= 0 AND x <= 100),
  y           REAL CHECK (y >= 0 AND y <= 100)
);
CREATE INDEX comments_project_idx ON comments (project_id, created_at DESC);
CREATE INDEX comments_revision_idx ON comments (revision_id);

CREATE TABLE decisions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id  TEXT NOT NULL REFERENCES revisions(id) ON DELETE RESTRICT,
  type         TEXT NOT NULL CHECK (type IN ('approved','changes-requested')),
  client_name  TEXT NOT NULL,
  client_email TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  receipt_code TEXT NOT NULL UNIQUE
);
CREATE INDEX decisions_project_idx ON decisions (project_id, created_at DESC);

CREATE TABLE review_tokens (
  token        TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX review_tokens_project_idx ON review_tokens (project_id);
CREATE UNIQUE INDEX review_tokens_active_project_idx
  ON review_tokens (project_id) WHERE revoked_at IS NULL;

CREATE TABLE activities (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('comment','upload','approval','invite','resolve','project')),
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL,
  actor        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX activities_workspace_idx ON activities (workspace_id, created_at DESC);

CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notifications_workspace_idx ON notifications (workspace_id, created_at DESC);
