-- Control-plane schema for Power Log Command's multi-company model.
-- This database holds ONLY the company registry, the login directory,
-- and the agency (Lucas's cross-company) account -- never any company's
-- actual app data (users, buildings, inspections, etc.), which each
-- lives in its own separate D1 database. See worker/tenant-db.js.

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'basic',
  building_limit INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  -- 'native' = Forest Hill Group, which still uses the fast static "DB"
  -- Worker binding directly. 'http' = every other (future) company,
  -- routed dynamically through Cloudflare's D1 HTTP API by database_id.
  database_kind TEXT NOT NULL DEFAULT 'http' CHECK (database_kind IN ('native', 'http')),
  database_id TEXT,
  database_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Email -> which company, so login can find the right database before
-- any session/company context exists yet. Kept in sync whenever a user
-- is created in any company database.
CREATE TABLE login_directory (
  email TEXT PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id)
);

-- Lucas's own cross-company "agency" login -- deliberately separate
-- from any one company's `users` table, since this account needs to
-- reach into every company's database, not live inside one of them.
CREATE TABLE agency_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agency_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT UNIQUE NOT NULL,
  agency_user_id INTEGER NOT NULL REFERENCES agency_users(id),
  -- Which company's database the agency account is currently "inside".
  -- NULL = the broad all-clients view, not inside any one company yet.
  active_client_id INTEGER REFERENCES clients(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
