-- Mandatory, timestamped "proof of presence" photo per equipment group per
-- day -- separate from the optional AI-reading group photo (which stays
-- gated to the beta tester and costs a Gemini call). This one is a plain
-- upload with a timestamp (and geolocation, if the browser grants it)
-- burned into the image client-side before it's ever sent, so a manager
-- can tell at a glance a photo wasn't reused from a previous day. One
-- inspection can't be submitted until every equipment group actually used
-- on the building's checklist has one for the day -- see
-- worker/inspections.js's submit-time check.
CREATE TABLE group_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES inspection_submissions(id) ON DELETE CASCADE,
  equipment_group_id INTEGER NOT NULL REFERENCES equipment_groups(id),
  photo_key TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (submission_id, equipment_group_id)
);
CREATE INDEX idx_group_photos_submission ON group_photos(submission_id);
