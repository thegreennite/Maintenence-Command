-- Cleaner role + custom designations, and the schedules tool.
--
-- Additive only (ALTER TABLE ADD COLUMN and new tables): users.role has a
-- CHECK constraint listing the allowed roles, and changing it would mean
-- rebuilding `users` -- which D1 can't do safely (see 0024's comment: it
-- doesn't honor PRAGMA foreign_keys=OFF, so dropping a referenced table
-- cascade-deletes its children). Operations Manager was already modeled
-- the same way: an existing role plus a flag. A Cleaner is stored as
-- role='superintendent' with staff_kind='cleaner', and worker/roles.js
-- presents it everywhere as its own role, 'cleaner'.
--
-- designation is the manager-editable variant label that rides on a role:
-- "Light duty" / "Heavy duty" for a cleaner, "Shared superintendent" /
-- "Assistant superintendent" for a superintendent, or anything custom.
ALTER TABLE users ADD COLUMN staff_kind TEXT;
ALTER TABLE users ADD COLUMN designation TEXT;

-- A schedule belongs to one building. Its tasks recur on weekdays; the
-- defaults below apply to any task that doesn't set its own.
CREATE TABLE schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  name TEXT NOT NULL,
  source_note TEXT,
  default_general_photos INTEGER NOT NULL DEFAULT 1,
  default_detail_photos INTEGER NOT NULL DEFAULT 3,
  enforce_times INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_schedules_building ON schedules (building_id, status);

-- Who the schedule is for (cleaners and/or superintendents).
CREATE TABLE schedule_assignees (
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, user_id)
);

-- Tasks are soft-deleted (active = 0), never removed: completed days
-- point at them as proof of work. NULL enforce_times / photo counts mean
-- "use the schedule's default".
CREATE TABLE schedule_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id),
  title TEXT NOT NULL,
  details TEXT,
  location TEXT,
  days TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  enforce_times INTEGER,
  general_photos INTEGER,
  detail_photos INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_schedule_tasks_schedule ON schedule_tasks (schedule_id, active);

-- One row per task per day. in_progress while photos are being taken;
-- completed only once the required photos are all in. The photo counts
-- required at the moment it started are frozen here so a manager editing
-- the task mid-day can't strand someone halfway through.
CREATE TABLE task_completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES schedule_tasks(id),
  building_id INTEGER NOT NULL REFERENCES buildings(id),
  date TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  late INTEGER NOT NULL DEFAULT 0,
  required_general INTEGER NOT NULL DEFAULT 1,
  required_detail INTEGER NOT NULL DEFAULT 3,
  UNIQUE (task_id, date)
);
CREATE INDEX idx_task_completions_day ON task_completions (building_id, date);

CREATE TABLE task_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  completion_id INTEGER NOT NULL REFERENCES task_completions(id),
  kind TEXT NOT NULL CHECK (kind IN ('general', 'detail')),
  photo_key TEXT NOT NULL,
  captured_at TEXT,
  latitude REAL,
  longitude REAL,
  distance_from_building_m INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_task_photos_completion ON task_photos (completion_id);
