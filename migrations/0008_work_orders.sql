-- Work orders: a Regional Manager's real tracking list, replacing the
-- mock Exception Queue. Manager-only -- no assignment/resolution workflow
-- on the superintendent side, per explicit scope decision.
--
-- Two sources:
--  'reading'  -- auto-created when a superintendent confirms an
--                out-of-range value as genuinely abnormal (not a typo)
--  'flagged'  -- a superintendent raises something not tied to a specific
--                reading (inventory, chemicals, a schedule/method question)
--                that needs the manager's attention rather than a quick
--                ask to a coworker

CREATE TABLE work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  created_by INTEGER REFERENCES users(id),
  source TEXT NOT NULL CHECK (source IN ('reading', 'flagged')),
  category TEXT,
  title TEXT NOT NULL,
  description TEXT,
  reading_tag_id INTEGER REFERENCES inspection_tags(id),
  reading_value TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id)
);

CREATE INDEX idx_work_orders_building_status ON work_orders(building_id, status);
