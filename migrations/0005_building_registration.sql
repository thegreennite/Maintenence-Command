-- Phase 6: building registration + AI-assisted checklist generation.

ALTER TABLE buildings ADD COLUMN address TEXT;
ALTER TABLE buildings ADD COLUMN created_by INTEGER REFERENCES users(id);

-- A second test superintendent, unassigned to any building, so a newly
-- registered building has someone real to assign and actually test with.
-- Password: FHG-Super2-2026! (PBKDF2-SHA256, 100k iterations, matching
-- worker/security.js — verified against the file below, same as every
-- other seed account).
INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, region) VALUES
  ('sam.rivera', '07a18d56c5146cd2c28b31b457f4342c79f5be6cbe2af7945a98e8c4e3100b7c', 'bc8b0d850c38fd1b593ccb8a128eaad9', 'Sam Rivera', 'Superintendent', 'superintendent', NULL);
