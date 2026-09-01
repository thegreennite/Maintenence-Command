-- Command mode: a guided, one-item-at-a-time inspection walkthrough for
-- superintendents (manual entry, camera capture, or photo upload per
-- reading), plus the machinery it depends on:
--   - physical locations per building (ROM/OM-managed) so the walkthrough
--     can be ordered by where the super actually is, and so a super can
--     flag an item whose location wasn't set up right rather than having
--     to backtrack mid-walk;
--   - a per-reading "flagged for later" state that gates final submit;
--   - a per-reading photo reference, so a value captured by camera keeps
--     its evidence photo attached to that specific item.

CREATE TABLE building_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_building_locations_building ON building_locations(building_id);

ALTER TABLE inspection_tags ADD COLUMN location_id INTEGER REFERENCES building_locations(id);

ALTER TABLE inspection_readings ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inspection_readings ADD COLUMN photo_key TEXT;
