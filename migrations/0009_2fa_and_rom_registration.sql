-- Weekly email 2FA (via GHL) + letting Regional Operations Managers
-- self-register too (previously only Superintendent/Property Manager could).

ALTER TABLE users ADD COLUMN last_2fa_verified_at TEXT;
ALTER TABLE users ADD COLUMN ghl_contact_id TEXT;

CREATE TABLE two_factor_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  pending_token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_two_factor_codes_pending_token ON two_factor_codes(pending_token);
