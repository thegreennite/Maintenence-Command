-- Equipment groups: a second, independent way to classify a checklist
-- item beyond its physical location (building_locations). A pump living
-- "Upstairs" (location) is also classified as "Pumps" (group); a boiler
-- in the same room is "Boilers". Custom per building, same shape as
-- building_locations on purpose.
CREATE TABLE equipment_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_equipment_groups_building ON equipment_groups(building_id);

ALTER TABLE inspection_tags ADD COLUMN equipment_group_id INTEGER REFERENCES equipment_groups(id);
