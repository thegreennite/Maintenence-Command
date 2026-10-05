-- Cleaner becomes a real role (users.role = 'cleaner') instead of a flag on
-- superintendents (0026's staff_kind).
--
-- The role list is a CHECK constraint on `users`, and SQLite can't alter a
-- CHECK in place, so `users` has to be rebuilt. That's the dangerous kind of
-- migration here (see 0024): D1 ignores PRAGMA foreign_keys=OFF, and dropping
-- `users` runs an implicit DELETE that fires every ON DELETE CASCADE aimed
-- at it. Exactly two tables cascade from users -- `sessions` and
-- `schedule_assignees` -- so both are copied out first and put back after.
-- Every other table that references users has no cascade; D1 does honor
-- `defer_foreign_keys`, which postpones their check to the end of the
-- migration. The order matters: SQLite counts a deferred violation when the
-- table is dropped and only clears it when matching parent rows are inserted
-- *afterwards*, so users is copied aside, dropped, recreated under its own
-- name, and refilled (no create-new-then-rename).
--
-- Nothing about any existing row changes except: the role of anyone flagged
-- staff_kind='cleaner' becomes 'cleaner', and the now-redundant staff_kind
-- column is gone.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE _bak_users AS SELECT * FROM users;
CREATE TABLE _bak_sessions AS SELECT * FROM sessions;
CREATE TABLE _bak_schedule_assignees AS SELECT * FROM schedule_assignees;

DROP TABLE users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'regional_manager', 'superintendent', 'cleaner', 'property_manager')),
  region TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  building_id INTEGER REFERENCES buildings(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'denied')),
  email TEXT,
  phone TEXT,
  profile_photo TEXT,
  last_2fa_verified_at TEXT,
  ghl_contact_id TEXT,
  building_access TEXT NOT NULL DEFAULT 'own' CHECK (building_access IN ('own', 'all')),
  contact_consent INTEGER NOT NULL DEFAULT 0,
  contact_consent_at TEXT,
  removed_at TEXT,
  classification TEXT NOT NULL DEFAULT 'standard',
  client_id INTEGER REFERENCES clients(id),
  designation TEXT
);
CREATE INDEX idx_users_role_active ON users (role, is_active);

INSERT INTO users (
  id, username, password_hash, password_salt, full_name, job_title, role, region, is_active, created_at,
  building_id, status, email, phone, profile_photo, last_2fa_verified_at, ghl_contact_id, building_access,
  contact_consent, contact_consent_at, removed_at, classification, client_id, designation
)
SELECT
  id, username, password_hash, password_salt, full_name,
  CASE WHEN staff_kind = 'cleaner' THEN 'Cleaner' ELSE job_title END,
  CASE WHEN staff_kind = 'cleaner' THEN 'cleaner' ELSE role END,
  region, is_active, created_at,
  building_id, status, email, phone, profile_photo, last_2fa_verified_at, ghl_contact_id, building_access,
  contact_consent, contact_consent_at, removed_at, classification, client_id, designation
FROM _bak_users;

INSERT INTO sessions (id, token_hash, user_id, actor_user_id, expires_at, created_at, last_seen_at, active_client_id)
  SELECT id, token_hash, user_id, actor_user_id, expires_at, created_at, last_seen_at, active_client_id FROM _bak_sessions;
INSERT INTO schedule_assignees (schedule_id, user_id) SELECT schedule_id, user_id FROM _bak_schedule_assignees;

DROP TABLE _bak_users;
DROP TABLE _bak_sessions;
DROP TABLE _bak_schedule_assignees;
