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

// Buildings a ROM can manage: their own (created_by) plus any an
// Operations Manager has explicitly shared with them (building_managers).
// A single fragment + the two params it needs (both session.id), reused
// everywhere a query would otherwise just filter on `<alias>.created_by
// = ?` -- keeps every scoped endpoint (locations, groups, notices, work
// orders, the dashboard, etc.) consistent as sharing gets used, rather
// than each one growing its own copy of the OR clause.
export function ownedOrSharedSql(alias = "b") {
  return `(${alias}.created_by = ? OR ${alias}.id IN (SELECT building_id FROM building_managers WHERE user_id = ?))`;
}
