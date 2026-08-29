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

-- Passwords hashed with PBKDF2-SHA256, 120,000 iterations, 32-byte output
-- (must match worker/security.js verifyPassword) — plaintext seed passwords
-- for local testing: admin/FHG-Admin-2026!, alex.kim/FHG-Manager-2026!,
-- jordan.lee/FHG-Super-2026!, taylor.morgan/FHG-Property-2026!
INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, region) VALUES
  ('admin', '800f2bd0e6d8e6d639e970ad8d8e2f034944e3674744283965e2c5a8fe311038', 'c0e6032d2388207c7175be50f5853563', 'Morgan Reed', 'System Administrator', 'admin', 'All regions'),
  ('alex.kim', '42e7fc8af976b10548edbf7c60209c33bb22d7357cd32d89dc79302258fcb944', '466e1ed7b3128649760e8bf12e6d1a9b', 'Alex Kim', 'Regional Operations Manager', 'regional_manager', 'Central Portfolio'),
  ('jordan.lee', '484ca24230660ee7b26f92d6199cc1bb3ef548a7c980e8d58b657538615f4a6a', '79733be6bfab3720dd5efba0fd58c6d0', 'Jordan Lee', 'Superintendent', 'superintendent', 'Harbour Point'),
  ('taylor.morgan', '526e65481446565e965648b17d70345ecdfa62b760dbf2749d6c21203df4922e', 'afb39819f2165a1ec816bd90b055fc09', 'Taylor Morgan', 'Property Manager', 'property_manager', 'Lakeshore Residences');

PRAGMA optimize;
