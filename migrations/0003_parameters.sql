-- Phase 3: Regional Manager optional parameters + green/yellow/red flagging.

ALTER TABLE inspection_tags ADD COLUMN value_type TEXT NOT NULL DEFAULT 'numeric'
  CHECK (value_type IN ('numeric', 'on_off'));
UPDATE inspection_tags SET value_type = 'on_off' WHERE reading_type = 'on/off';

-- One optional row per tag. No row = "not evaluated" (parameters are opt-in,
-- per the original spec: a manager doesn't have to set them).
-- numeric tags use min_value/max_value; on_off tags use expected_value.
CREATE TABLE inspection_parameters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_id INTEGER NOT NULL UNIQUE REFERENCES inspection_tags(id),
  min_value REAL,
  max_value REAL,
  expected_value TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
