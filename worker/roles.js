// Cleaner and the manager-editable designation.
//
// `users.role` has a CHECK constraint listing the allowed roles, and
// rebuilding `users` to change it isn't safe on D1 (see migrations/0024
// and 0026), so a Cleaner is stored as role = 'superintendent' with
// staff_kind = 'cleaner' -- the same trick Operations Manager already
// uses (a regional_manager with building_access = 'all'). Everything
// outside the database sees a Cleaner as its own role, 'cleaner', via
// effectiveRole(); that's what keeps one from ever being treated as a
// superintendent (no inspection access, not counted as one).

export const STAFF_KIND_CLEANER = "cleaner";

// Quick picks shown to managers; anything else typed in is a custom one.
export const DESIGNATION_PRESETS = {
  cleaner: ["Light duty", "Heavy duty"],
  superintendent: ["Shared superintendent", "Assistant superintendent"],
};

export function effectiveRole(row) {
  if (row?.role === "superintendent" && row?.staff_kind === STAFF_KIND_CLEANER) return "cleaner";
  return row?.role;
}

export function cleanDesignation(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return text || null;
}

// SQL fragment for "a real superintendent, not a cleaner" -- every query
// that means superintendents (counts, assignment lists, coverage) uses it
// now that cleaners share the same stored role.
export const REAL_SUPER_ONLY = "staff_kind IS NULL";
