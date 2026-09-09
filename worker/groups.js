// Equipment groups: a custom, per-building classification for checklist
// items -- independent of physical location. "Pumps" and "Boilers" might
// both live in the same mechanical room (same location), but a manager
// still wants to group/label a reading by what kind of equipment it is.
// Same shape and pattern as building_locations/worker/locations.js on
// purpose -- two independent classification axes over the same tags.

import { canSeeAllBuildings, ownedOrSharedSql } from "./access.js";

async function ownsBuilding(env, session, buildingId) {
  if (canSeeAllBuildings(session)) {
    return env.DB.prepare("SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL").bind(buildingId).first();
  }
  return env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL AND ${ownedOrSharedSql("buildings")}`)
    .bind(buildingId, session.id, session.id)
    .first();
}

export async function handleListGroups(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Building not found.", 404, corsHeaders);

  const result = await env.DB.prepare(
    "SELECT id, name, sort_order FROM equipment_groups WHERE building_id = ? ORDER BY sort_order, name",
  )
    .bind(buildingId)
    .all();
  return jsonOk({ groups: result.results }, corsHeaders);
}

export async function handleCreateGroup(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const name = String(body.name || "").trim();
  if (!name) return jsonError("A group name is required.", 400, corsHeaders);
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Building not found.", 404, corsHeaders);

  const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM equipment_groups WHERE building_id = ?")
    .bind(buildingId)
    .first();
  const inserted = await env.DB.prepare(
    "INSERT INTO equipment_groups (building_id, name, sort_order) VALUES (?, ?, ?)",
  )
    .bind(buildingId, name, (max?.m ?? -1) + 1)
    .run();
  return jsonOk({ group: { id: inserted.meta.last_row_id, name, sort_order: (max?.m ?? -1) + 1 } }, corsHeaders);
}

export async function handleDeleteGroup(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const groupId = Number.parseInt(body.groupId, 10);
  const group = await env.DB.prepare("SELECT id, building_id FROM equipment_groups WHERE id = ?").bind(groupId).first();
  if (!group) return jsonError("Group not found.", 404, corsHeaders);
  if (!(await ownsBuilding(env, session, group.building_id))) return jsonError("Group not found.", 404, corsHeaders);

  await env.DB.batch([
    env.DB.prepare("UPDATE inspection_tags SET equipment_group_id = NULL WHERE equipment_group_id = ?").bind(groupId),
    env.DB.prepare("DELETE FROM equipment_groups WHERE id = ?").bind(groupId),
  ]);
  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleAssignTagGroup(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const tagId = Number.parseInt(body.tagId, 10);
  const groupId = body.groupId == null || body.groupId === "" ? null : Number.parseInt(body.groupId, 10);

  const tag = await env.DB.prepare("SELECT id, building_id FROM inspection_tags WHERE id = ?").bind(tagId).first();
  if (!tag) return jsonError("Reading not found.", 404, corsHeaders);
  if (!(await ownsBuilding(env, session, tag.building_id))) return jsonError("Reading not found.", 404, corsHeaders);

  if (groupId != null) {
    const group = await env.DB.prepare("SELECT id FROM equipment_groups WHERE id = ? AND building_id = ?")
      .bind(groupId, tag.building_id)
      .first();
    if (!group) return jsonError("Group not found.", 404, corsHeaders);
  }

  await env.DB.prepare("UPDATE inspection_tags SET equipment_group_id = ? WHERE id = ?").bind(groupId, tagId).run();
  return jsonOk({ ok: true }, corsHeaders);
}

// Bulk location assignment: everything in "Elevator Machine Room" (a
// group) is physically in one spot ("MPH") -- set every tag in that group
// at once instead of one dropdown per reading. Accepts either one
// groupId or several at once (groupIds), for tagging a whole cluster of
// machines -- e.g. Boilers + Domestic Hot Water -- to the same location
// in one action instead of doing each group one at a time.
export async function handleAssignGroupLocation(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const groupIds = Array.isArray(body.groupIds)
    ? body.groupIds.map((id) => Number.parseInt(id, 10)).filter(Boolean)
    : [Number.parseInt(body.groupId, 10)].filter(Boolean);
  const locationId = body.locationId == null || body.locationId === "" ? null : Number.parseInt(body.locationId, 10);

  if (!groupIds.length) return jsonError("Select at least one machine.", 400, corsHeaders);

  const groups = await env.DB.prepare(
    `SELECT id, building_id FROM equipment_groups WHERE id IN (${groupIds.map(() => "?").join(",")})`,
  )
    .bind(...groupIds)
    .all();
  if (groups.results.length !== groupIds.length) return jsonError("Group not found.", 404, corsHeaders);
  const buildingId = groups.results[0].building_id;
  if (groups.results.some((g) => g.building_id !== buildingId)) {
    return jsonError("All selected machines must belong to the same building.", 400, corsHeaders);
  }
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Group not found.", 404, corsHeaders);

  if (locationId != null) {
    const location = await env.DB.prepare("SELECT id FROM building_locations WHERE id = ? AND building_id = ?")
      .bind(locationId, buildingId)
      .first();
    if (!location) return jsonError("Location not found.", 404, corsHeaders);
  }

  const result = await env.DB.prepare(
    `UPDATE inspection_tags SET location_id = ? WHERE equipment_group_id IN (${groupIds.map(() => "?").join(",")})`,
  )
    .bind(locationId, ...groupIds)
    .run();
  return jsonOk({ ok: true, count: result.meta.changes }, corsHeaders);
}

// The AI-generated (or hand-typed) name for a machine's group is sometimes
// wrong or just not how this building's crew refers to it -- let the
// manager fix it in place rather than delete-and-recreate the group.
export async function handleRenameGroup(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const groupId = Number.parseInt(body.groupId, 10);
  const name = String(body.name || "").trim();
  if (!name) return jsonError("A name is required.", 400, corsHeaders);

  const group = await env.DB.prepare("SELECT id, building_id FROM equipment_groups WHERE id = ?").bind(groupId).first();
  if (!group) return jsonError("Group not found.", 404, corsHeaders);
  if (!(await ownsBuilding(env, session, group.building_id))) return jsonError("Group not found.", 404, corsHeaders);

  await env.DB.prepare("UPDATE equipment_groups SET name = ? WHERE id = ?").bind(name, groupId).run();
  return jsonOk({ ok: true, name }, corsHeaders);
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
