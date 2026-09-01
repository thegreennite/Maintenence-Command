-- Operations Manager (OM): sees every registered building, unlike a
-- Regional Manager (ROM) who only sees buildings they personally
-- registered. Rather than adding a new `role` enum value (which would
-- require rebuilding `users` -- D1 enforces FK constraints from
-- sessions/buildings/work_orders/etc. even through the standard SQLite
-- "disable foreign_keys, rebuild, re-enable" pattern; tested and confirmed
-- it still fails at commit), OM is `role = 'regional_manager'` plus this
-- new scope column. The app computes the displayed role name from the
-- combination -- functionally identical to a real new role, zero risk to
-- existing data.
ALTER TABLE users ADD COLUMN building_access TEXT NOT NULL DEFAULT 'own'
  CHECK (building_access IN ('own', 'all'));

-- Work order assignment: a manager hands something off to whoever should
-- actually handle it (e.g. an Operations Manager specializing in that
-- kind of issue).
ALTER TABLE work_orders ADD COLUMN assigned_to INTEGER REFERENCES users(id);
ALTER TABLE work_orders ADD COLUMN assigned_at TEXT;

-- Per-building notices board: short instructions a manager posts for
-- whoever covers that building -- separate from the daily inspection
-- checklist itself. Editable/removable, not versioned.
CREATE TABLE building_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  created_by INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_building_notices_building ON building_notices(building_id);
