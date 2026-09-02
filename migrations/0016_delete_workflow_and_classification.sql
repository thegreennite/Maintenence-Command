-- Buildings: a request/approve delete workflow with a 30-day-kept soft
-- delete, instead of a Regional/Operations Manager's delete being instant
-- and permanent. buildings.status stays CHECK-constrained to
-- ('registering', 'active') on purpose (see worker/access.js's notes on
-- this pattern) -- these are new, unconstrained columns instead.
ALTER TABLE buildings ADD COLUMN delete_requested_at TEXT;
ALTER TABLE buildings ADD COLUMN delete_requested_by INTEGER REFERENCES users(id);
ALTER TABLE buildings ADD COLUMN deleted_at TEXT;
ALTER TABLE buildings ADD COLUMN deleted_by INTEGER REFERENCES users(id);

-- Users: an admin-only "remove this profile" (soft-delete -- blocks login,
-- disappears from every list, but old inspection history still shows
-- their name) and an admin-settable classification, used right now to
-- gate the AI photo-reading feature to just the beta tester.
ALTER TABLE users ADD COLUMN removed_at TEXT;
ALTER TABLE users ADD COLUMN classification TEXT NOT NULL DEFAULT 'standard';

UPDATE users SET classification = 'beta_tester' WHERE username = 'sam.rivera';
