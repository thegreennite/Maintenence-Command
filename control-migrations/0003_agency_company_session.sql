-- The agency account needs a REAL session row inside whichever company
-- it's currently looking at (not just a synthesized "pretend you're
-- admin" object) so impersonation's UPDATE-based hand-off (worker/
-- index.js: handleImpersonate/handleAdminReturn) works for it exactly
-- like it does for that company's own real admin -- see the detailed
-- comment on requireAgencySession. This column points at that row's id
-- inside the target company's own database (set by handleSwitchClient).
ALTER TABLE agency_sessions ADD COLUMN company_session_id INTEGER;
