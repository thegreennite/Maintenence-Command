-- Self-registration (Superintendent / Property Manager sign themselves up
-- against an existing building, pending Regional Manager approval) and the
-- draft -> live gate on newly registered buildings.

ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('pending', 'active', 'denied'));
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN profile_photo TEXT;

-- 'registering' buildings are invisible to their assigned superintendent
-- until a Regional Manager explicitly pushes them live.
ALTER TABLE buildings ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('registering', 'active'));
