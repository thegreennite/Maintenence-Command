-- Two additive columns (plain ADD COLUMN -- no table rebuild, see 0024's
-- comment for why a rebuild isn't safe on D1).
--
-- inspection_tags.monitor_trend: whether unusual day-to-day changes in
-- this reading get flagged (default yes). A few readings legitimately
-- swing on their own -- e.g. a sprinkler system's "Water Building"
-- pressure follows the building's own supply -- and a manager can turn
-- the trend check off for just those rather than the whole building.
--
-- inspection_readings.deviation: set server-side at save/submit time
-- whenever a numeric reading falls outside its learned normal (or the
-- manager's min/max). A small JSON blob: baseline, change, tolerance,
-- basis, and how the superintendent answered the prompt (ack). Stored
-- on the reading itself so the weekly report and manager views never
-- depend on the client having shown a prompt.
ALTER TABLE inspection_tags ADD COLUMN monitor_trend INTEGER NOT NULL DEFAULT 1;
ALTER TABLE inspection_readings ADD COLUMN deviation TEXT;

-- Sprinkler "Water Building" pressure is the one reading Lucas wants
-- accepted as-is; Air Water and Water City stay monitored.
UPDATE inspection_tags SET monitor_trend = 0
 WHERE LOWER(system_name || ' ' || COALESCE(tag_no, '')) LIKE '%sprinkler%'
   AND LOWER(reading_type) LIKE '%water%building%';
