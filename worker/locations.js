// Physical locations within a building (e.g. "Penthouse Mechanical", "P3
// Parking Level") -- every building lays its equipment out differently, so
// this is ROM/OM-managed per building rather than a fixed list. Assigning a
// tag to a location lets command mode walk a superintendent through their
// readings in physical order instead of checklist order.

import { canSeeAllBuildings, ownedOrSharedSql } from "./access.js";

async function ownsBuilding(env, session, buildingId) {
  if (canSeeAllBuildings(session)) {
    return env.DB.prepare("SELECT id FROM buildings WHERE id = ?").bind(buildingId).first();
  }
  return env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND ${ownedOrSharedSql("buildings")}`)
    .bind(buildingId, session.id, session.id)
    .first();
}

export async function handleListLocations(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Building not found.", 404, corsHeaders);

  const result = await env.DB.prepare(
    "SELECT id, name, sort_order FROM building_locations WHERE building_id = ? ORDER BY sort_order, name",
  )
    .bind(buildingId)
    .all();
  return jsonOk({ locations: result.results }, corsHeaders);
}

export async function handleCreateLocation(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const name = String(body.name || "").trim();
  if (!name) return jsonError("A location name is required.", 400, corsHeaders);
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Building not found.", 404, corsHeaders);

  const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM building_locations WHERE building_id = ?")
    .bind(buildingId)
    .first();
  const inserted = await env.DB.prepare(
    "INSERT INTO building_locations (building_id, name, sort_order) VALUES (?, ?, ?)",
  )
    .bind(buildingId, name, (max?.m ?? -1) + 1)
    .run();
  return jsonOk({ location: { id: inserted.meta.last_row_id, name, sort_order: (max?.m ?? -1) + 1 } }, corsHeaders);
}

export async function handleDeleteLocation(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const locationId = Number.parseInt(body.locationId, 10);
  const location = await env.DB.prepare("SELECT id, building_id FROM building_locations WHERE id = ?").bind(locationId).first();
  if (!location) return jsonError("Location not found.", 404, corsHeaders);
  if (!(await ownsBuilding(env, session, location.building_id))) return jsonError("Location not found.", 404, corsHeaders);

  // Tags pointed at this location fall back to unassigned rather than being
  // blocked from deletion -- the FK has no ON DELETE clause in SQLite by
  // default, so clear it explicitly first.
  await env.DB.batch([
    env.DB.prepare("UPDATE inspection_tags SET location_id = NULL WHERE location_id = ?").bind(locationId),
    env.DB.prepare("DELETE FROM building_locations WHERE id = ?").bind(locationId),
  ]);
  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleAssignTagLocation(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const tagId = Number.parseInt(body.tagId, 10);
  const locationId = body.locationId == null || body.locationId === "" ? null : Number.parseInt(body.locationId, 10);

  const tag = await env.DB.prepare("SELECT id, building_id FROM inspection_tags WHERE id = ?").bind(tagId).first();
  if (!tag) return jsonError("Reading not found.", 404, corsHeaders);
  if (!(await ownsBuilding(env, session, tag.building_id))) return jsonError("Reading not found.", 404, corsHeaders);

  if (locationId != null) {
    const location = await env.DB.prepare("SELECT id FROM building_locations WHERE id = ? AND building_id = ?")
      .bind(locationId, tag.building_id)
      .first();
    if (!location) return jsonError("Location not found.", 404, corsHeaders);
  }

  await env.DB.prepare("UPDATE inspection_tags SET location_id = ? WHERE id = ?").bind(locationId, tagId).run();
  return jsonOk({ ok: true }, corsHeaders);
}

function jsonOk(data, headers) {
  return new Response(JSON.stringify(data), { status: 200, headers: withJsonHeaders(headers) });
}

function jsonError(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), { status, headers: withJsonHeaders(headers) });
}

function withJsonHeaders(headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return responseHeaders;
}
