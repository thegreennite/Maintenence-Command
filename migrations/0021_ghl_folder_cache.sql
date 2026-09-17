-- Persists GHL Media Library folder ids across Worker isolates -- the
-- in-memory Map cache in worker/ghl-media.js only lives as long as one
-- warm isolate, so most photo uploads were paying a full "list, maybe
-- create" GHL API round trip (sometimes two, for building then week)
-- before the actual upload could even start. A building/week combo's
-- folder id never changes once created, so this only needs to be
-- resolved once, ever.
CREATE TABLE ghl_folder_cache (
  cache_key TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
