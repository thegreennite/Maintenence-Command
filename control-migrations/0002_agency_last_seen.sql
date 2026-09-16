-- Missed on the first pass: requireAgencySession (worker/index.js) reads
-- and updates last_seen_at for inactivity-timeout tracking, exactly like
-- every company's own `sessions` table already does. D1/SQLite won't
-- allow ADD COLUMN with a non-constant default (CURRENT_TIMESTAMP), so
-- this is nullable + backfilled -- tryAgencyLogin sets it explicitly on
-- every new INSERT going forward.
ALTER TABLE agency_sessions ADD COLUMN last_seen_at TEXT;
UPDATE agency_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE last_seen_at IS NULL;
