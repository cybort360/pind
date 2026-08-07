-- Pind authentication: owner password plus revocable httpOnly sessions.
-- Sessions are stored as a hash of the bearer token so a database leak does
-- not expose usable credentials.

ALTER TABLE users ADD COLUMN password_hash TEXT;

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL DEFAULT 'password' CHECK (kind IN ('password','demo')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX sessions_workspace_idx ON sessions (workspace_id);