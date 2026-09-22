-- Per-machine override for the mandatory compliance-photo rule -- most
-- machines should still require one, but a manager can turn it off for
-- ones where it doesn't make sense (e.g. a reading that isn't really
-- "a machine" in the physical-proof-of-presence sense).
ALTER TABLE equipment_groups ADD COLUMN requires_photo INTEGER NOT NULL DEFAULT 1;
