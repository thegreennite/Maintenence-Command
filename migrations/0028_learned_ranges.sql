-- What a machine has been taught is normal. When a superintendent marks a flagged
-- reading "normal" at the end of an inspection, the allowed range for that reading
-- (in that on/off/auto state) stretches to include it. Also created on demand by
-- worker/learned-ranges.js, so companies whose database predates this migration
-- pick the table up without a manual step.
CREATE TABLE IF NOT EXISTS learned_ranges (
  tag_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT '',
  lo REAL NOT NULL,
  hi REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tag_id, state)
);
