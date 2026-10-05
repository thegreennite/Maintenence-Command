// Cleaner is its own role (users.role = 'cleaner', added in migration 0027),
// and every account can carry a manager-editable designation -- a free-text
// variant label on top of the role ("Light duty", "Assistant superintendent",
// anything custom).

// Quick picks shown to managers; anything else typed in is a custom one.
export const DESIGNATION_PRESETS = {
  cleaner: ["Light duty", "Heavy duty"],
  superintendent: ["Shared superintendent", "Assistant superintendent"],
};

export function cleanDesignation(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return text || null;
}
