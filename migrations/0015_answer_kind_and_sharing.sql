-- reading_kind's CHECK constraint hits the exact same D1 rebuild wall
-- value_type did before it (see 0010, 0014) -- every future "add a
-- reading type" request (this time: sprinklers reading Open/Closed) would
-- need its own migration like this one. Stop using a CHECK on this field
-- permanently: one more column, no constraint, validated in application
-- code instead. Never needs to migrate again for a new type.
ALTER TABLE inspection_tags ADD COLUMN answer_kind TEXT NOT NULL DEFAULT 'numeric';
UPDATE inspection_tags SET answer_kind = reading_kind;

-- Building sharing: an Operations Manager can grant a specific Regional
-- Manager full access to a building that ROM didn't personally register
-- (they already see everything; this lets them extend that to a ROM at
-- their discretion). Additive to created_by-based ownership, not a
-- replacement -- a building can have any number of grants.
CREATE TABLE building_managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  granted_by INTEGER REFERENCES users(id),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (building_id, user_id)
);
CREATE INDEX idx_building_managers_building ON building_managers(building_id);
CREATE INDEX idx_building_managers_user ON building_managers(user_id);

-- A superintendent's daily note for one equipment group as a whole (e.g.
-- "Elevator machine room: strong smell today, advised caution") rather
-- than per individual reading -- written inline while filling out the
-- regular form, one per group per day.
CREATE TABLE group_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES inspection_submissions(id) ON DELETE CASCADE,
  equipment_group_id INTEGER NOT NULL REFERENCES equipment_groups(id),
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (submission_id, equipment_group_id)
);
CREATE INDEX idx_group_notes_submission ON group_notes(submission_id);
