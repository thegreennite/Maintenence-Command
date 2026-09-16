-- How far a compliance photo's captured GPS position was from the
-- building's own registered address, in meters -- NULL when either
-- point is missing (no geolocation granted, or the building has no
-- registered address yet). A flag, not an enforcement: GPS drift near
-- a large property is normal, so this is surfaced as a warning, never
-- used to block a submission.
ALTER TABLE group_photos ADD COLUMN distance_from_building_m REAL;
