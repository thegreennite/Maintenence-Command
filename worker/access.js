// Building-access scoping, used everywhere a query needs to know "which
// buildings can this session see."
//
// Regional Manager (ROM): only buildings they personally registered
// (created_by = their own id).
// Operations Manager (OM): role='regional_manager' + building_access='all'
// -- same role in the database, wider scope. Sees every building, and can
// be handed a work order by a ROM for cross-building coordination.
// Admin: everything, same as OM.

export function canSeeAllBuildings(session) {
  return session.role === "admin" || session.building_access === "all";
}
