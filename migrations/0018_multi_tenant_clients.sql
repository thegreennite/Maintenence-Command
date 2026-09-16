-- Multi-tenancy: "Power Log Command" is sold to multiple maintenance
-- companies, each a `clients` row (Basic/Plus/Pro, building_limit set
-- accordingly -- NULL means unlimited). Every building and every user
-- belongs to exactly one client. An admin can switch which client's data
-- they're currently looking at (sessions.active_client_id); everyone else
-- is permanently scoped to their own client_id. No CHECK constraint on
-- plan (see this repo's established pattern -- SQLite CHECK constraints
-- can't be widened later without a full table rebuild, and D1 enforces FK
-- constraints during that rebuild even with PRAGMAs off -- validated in
-- application code instead).
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'pro',
  building_limit INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Nullable at the DB level on purpose -- D1/SQLite can't add a NOT NULL
-- column with no default to a table that already has rows in one step.
-- Enforced as required in application code for every new insert going
-- forward; backfilled below for every row that already exists.
ALTER TABLE users ADD COLUMN client_id INTEGER REFERENCES clients(id);
ALTER TABLE buildings ADD COLUMN client_id INTEGER REFERENCES clients(id);
ALTER TABLE sessions ADD COLUMN active_client_id INTEGER REFERENCES clients(id);

-- Everything that already exists is Forest Hill Group's.
INSERT INTO clients (name, plan, building_limit) VALUES ('Forest Hill Group', 'pro', NULL);
UPDATE users SET client_id = (SELECT id FROM clients WHERE name = 'Forest Hill Group');
UPDATE buildings SET client_id = (SELECT id FROM clients WHERE name = 'Forest Hill Group');
UPDATE sessions SET active_client_id = (SELECT id FROM clients WHERE name = 'Forest Hill Group');
