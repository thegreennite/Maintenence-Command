-- Phase 2: Superintendent manual inspection entry.
-- One building per superintendent for now (building_id on users) — Phase 6
-- generalizes this to real registration + multi-building assignment.

CREATE TABLE buildings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  region TEXT,
  inspection_days TEXT NOT NULL DEFAULT 'Mon,Tue,Wed,Thu,Fri',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN building_id INTEGER REFERENCES buildings(id);

-- The checklist for a building's daily inspection — one row per reading.
-- Phase 6 will let each building upload its own paper sheet and generate
-- this table from it; for now it's seeded by hand to match the real
-- "Building Heating" section of an actual Forest Hill inspection sheet.
CREATE TABLE inspection_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  system_name TEXT NOT NULL,
  tag_no TEXT,
  reading_type TEXT NOT NULL,
  unit TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- One row per building per day. UNIQUE enforces "today's inspection" being
-- a single evolving record — save-as-draft updates it, submit locks it.
CREATE TABLE inspection_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  superintendent_id INTEGER NOT NULL REFERENCES users(id),
  inspection_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  notes TEXT,
  UNIQUE (building_id, inspection_date)
);

CREATE TABLE inspection_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES inspection_submissions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES inspection_tags(id),
  value TEXT,
  UNIQUE (submission_id, tag_id)
);

CREATE INDEX idx_submissions_building_date ON inspection_submissions(building_id, inspection_date);
CREATE INDEX idx_readings_submission ON inspection_readings(submission_id);

INSERT INTO buildings (name, region) VALUES ('Harbour Point', 'Central Portfolio');

UPDATE users SET building_id = (SELECT id FROM buildings WHERE name = 'Harbour Point')
  WHERE username = 'jordan.lee';

INSERT INTO inspection_tags (building_id, system_name, tag_no, reading_type, unit, sort_order) VALUES
  (1, 'Building Heating', NULL, 'Outside temperature', '°', 1),
  (1, 'Building Heating', NULL, 'Building supply temp.', '°', 2),
  (1, 'Building Heating', NULL, 'Building return temp.', '°', 3),
  (1, 'Building Heating', 'Boiler: H1A', 'on/off', NULL, 4),
  (1, 'Building Heating', 'Boiler: H1A', 'Inlet temperature', '°', 5),
  (1, 'Building Heating', 'Boiler: H1A', 'Outlet temperature', '°', 6),
  (1, 'Building Heating', 'Boiler: H1A', 'Inlet pressure', 'PSI', 7),
  (1, 'Building Heating', 'Pump: P9A', 'on/off', NULL, 8),
  (1, 'Building Heating', 'Pump: P9A', 'Pressure', 'PSI', 9);
