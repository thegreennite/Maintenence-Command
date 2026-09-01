-- A third reading shape alongside numeric and on/off: "hoa" for a
-- Hand-Off-Auto selector switch, standard on pumps/fans/motors -- the
-- equipment can be found in Hand (forced on manually), Off, or Auto
-- (running under automatic control), not just a plain on/off.
--
-- inspection_tags.value_type is CHECK-constrained to ('numeric','on_off')
-- and D1 can't rebuild this table to widen that CHECK -- confirmed
-- earlier: the standard SQLite rebuild pattern fails on FK constraints
-- in D1 regardless of PRAGMA settings (same issue that blocked expanding
-- users.role for the OM role; see migration 0010). Add a new column with
-- the wider constraint instead and use it everywhere going forward --
-- same approach as building_access. value_type itself is left in place,
-- unused, rather than risk a rebuild.
ALTER TABLE inspection_tags ADD COLUMN reading_kind TEXT NOT NULL DEFAULT 'numeric'
  CHECK (reading_kind IN ('numeric', 'on_off', 'hoa'));
UPDATE inspection_tags SET reading_kind = value_type;
