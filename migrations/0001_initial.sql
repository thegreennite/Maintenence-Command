CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'regional_manager', 'superintendent', 'property_manager')),
  region TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  actor_user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_users_role_active ON users(role, is_active);

INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, region) VALUES
  ('admin', 'c2a4f9820c680f5d96a9d0b6e7e5076b6b79718842e2b559f9f8eb95818b4d24', 'c0e6032d2388207c7175be50f5853563', 'Morgan Reed', 'System Administrator', 'admin', 'All regions'),
  ('alex.kim', '35c5bd5efa399073b4d08dab214a20556573677037ba82afb929bafcd2f5661b', '466e1ed7b3128649760e8bf12e6d1a9b', 'Alex Kim', 'Regional Operations Manager', 'regional_manager', 'Central Portfolio'),
  ('jordan.lee', 'b49358ecea56cdc25bb1d9c3216c10242f78a4ee8ca28261958331bf23c55a15', '79733be6bfab3720dd5efba0fd58c6d0', 'Jordan Lee', 'Superintendent', 'superintendent', 'Harbour Point'),
  ('taylor.morgan', 'd2496cbf51756ef3383a4707123ca70bce27cf1896a6158886d482a90a1ebddb', 'afb39819f2165a1ec816bd90b055fc09', 'Taylor Morgan', 'Property Manager', 'property_manager', 'Lakeshore Residences');

PRAGMA optimize;
