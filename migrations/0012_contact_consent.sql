-- TCPA/CASL-style consent tracking: self-registering accounts now check a
-- box agreeing to receive text messages and emails about their account
-- (this is also the channel the weekly 2FA code and future notifications
-- go out on) -- record that they agreed and when, not just that the box
-- was checked at some point in the UI.
ALTER TABLE users ADD COLUMN contact_consent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN contact_consent_at TEXT;
