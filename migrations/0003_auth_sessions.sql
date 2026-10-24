-- Authentication spec (cms-auto-login-spec.md):
-- persistent login sessions for the admin SPA plus the columns the new
-- auth surface needs. Existing password/auth logic is untouched; this only
-- adds the auth-specific storage.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at);

-- Keeps expired/revoked rows from becoming an unbounded table.
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);
