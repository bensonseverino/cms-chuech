-- Site settings (forms-reviews spec sections 5 and 7): key-value JSON blobs.
-- The key `notifications` holds `{ enabled, emails }` and is read by the
-- public site functions (notification recipients) and the admin Settings
-- screen (notifications card + test email).

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
