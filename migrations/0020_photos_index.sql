-- Backend-agnostic index of every stored photo -- lets listing/viewing
-- work the same way whether a photo lives in R2 (legacy) or a company's
-- own GoHighLevel Media Library (new; see worker/ghl-media.js). Existing
-- R2 objects get backfilled into this table once (see the one-time
-- migration script run alongside this), so nothing already stored has
-- to move for viewing to keep working -- only new uploads change where
-- the actual bytes land.
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  context TEXT,
  backend TEXT NOT NULL DEFAULT 'r2' CHECK (backend IN ('r2', 'ghl')),
  location TEXT NOT NULL,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_photos_building_date ON photos (building_id, date);
