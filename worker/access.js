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

// Multi-tenant: every company (a maintenance company Inspect N Snap is
// sold to) has its own physically separate database (see
// worker/tenant-db.js) -- which one a request even talks to is resolved
// before any handler runs (requireSession in index.js swaps env.DB to
// the right one). session.client_id here is always the LOCAL self-id
// inside that resolved database (always 1 by construction), never the
// separate control-plane id that picked the database in the first
// place -- see the detailed comment in requireSession. Given that, this
// client_id scoping is now defense-in-depth rather than the primary
// isolation boundary: it doesn't hurt, and it's what stops a bug in a
// single query from accidentally touching another row even though
// there's only ever one company's rows in play at all. active_client_id
// is a leftover from before physical separation; it's never set on a
// company's own sessions row anymore, so this always falls through to
// session.client_id in practice.
export function effectiveClientId(session) {
  if (session.role === "admin") return session.active_client_id ?? session.client_id ?? null;
  return session.client_id ?? null;
}

export function clientScopeSql(alias = "b") {
  return `${alias}.client_id = ?`;
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
