// Equipment groups: a custom, per-building classification for checklist
// items -- independent of physical location. "Pumps" and "Boilers" might
// both live in the same mechanical room (same location), but a manager
// still wants to group/label a reading by what kind of equipment it is.
// Same shape and pattern as building_locations/worker/locations.js on
// purpose -- two independent classification axes over the same tags.

import { canSeeAllBuildings, ownedOrSharedSql, effectiveClientId, clientScopeSql } from "./access.js";

async function ownsBuilding(env, session, buildingId) {
  const clientId = effectiveClientId(session);
  if (canSeeAllBuildings(session)) {
    return env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL AND ${clientScopeSql("buildings")}`)
      .bind(buildingId, clientId)
      .first();
  }
  return env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL AND ${clientScopeSql("buildings")} AND ${ownedOrSharedSql("buildings")}`)
    .bind(buildingId, clientId, session.id, session.id)
    .first();
}

export async function handleListGroups(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Building not found.", 404, corsHeaders);

  const result = await env.DB.prepare(
    "SELECT id, name, sort_order, requires_photo FROM equipment_groups WHERE building_id = ? ORDER BY sort_order, name",
  )
    .bind(buildingId)
    .all();
  return jsonOk({ groups: result.results }, corsHeaders);
}

// Per-machine override for the mandatory compliance-photo rule (see
// migrations/0022_group_requires_photo.sql) -- checked at submit time in
// worker/inspections.js, and mirrored client-side so command mode never
// even shows the photo interstitial for a machine that doesn't need one.
export async function handleSetGroupPhotoRequirement(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const groupId = Number.parseInt(body.groupId, 10);
  const requiresPhoto = body.requiresPhoto ? 1 : 0;

  const group = await env.DB.prepare("SELECT id, building_id FROM equipment_groups WHERE id = ?").bind(groupId).first();
  if (!group) return jsonError("Machine not found.", 404, corsHeaders);
  if (!(await ownsBuilding(env, session, group.building_id))) return jsonError("Machine not found.", 404, corsHeaders);

  await env.DB.prepare("UPDATE equipment_groups SET requires_photo = ? WHERE id = ?").bind(requiresPhoto, groupId).run();
  return jsonOk({ ok: true, requiresPhoto: Boolean(requiresPhoto) }, corsHeaders);
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

// Drag-and-drop reordering within a machine (or the ungrouped zone) --
// sets the whole zone's reading order in one shot, and doubles as
// handleAssignTagGroup when the drop also changes which machine a
// reading belongs to (the machine board's drag handler always sends
// the full desired order for wherever it landed).
//
// Reuses the exact sort_order values this set of readings already
// holds (just permuted into the new sequence) instead of handing out
// fresh ones -- keeps this whole block sitting in the same place in
// the building's overall reading order relative to every other
// machine, rather than scrambling that too. Never collides with an
// untouched reading's sort_order, since every value used here already
// belonged to one of these exact rows.
export async function handleReorderTags(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const groupId = body.groupId == null || body.groupId === "" ? null : Number.parseInt(body.groupId, 10);
  const orderedTagIds = Array.isArray(body.orderedTagIds)
    ? body.orderedTagIds.map((id) => Number.parseInt(id, 10)).filter((id) => Number.isInteger(id))
    : [];
  if (!orderedTagIds.length) return jsonError("Nothing to reorder.", 400, corsHeaders);

  const placeholders = orderedTagIds.map(() => "?").join(",");
  const existing = await env.DB.prepare(
    `SELECT id, building_id, COALESCE(board_sort_order, sort_order) AS board_sort_order FROM inspection_tags WHERE id IN (${placeholders})`,
  )
    .bind(...orderedTagIds)
    .all();
  if (existing.results.length !== orderedTagIds.length) return jsonError("Reading not found.", 404, corsHeaders);

  const buildingId = existing.results[0].building_id;
  if (existing.results.some((r) => r.building_id !== buildingId)) return jsonError("Reading not found.", 404, corsHeaders);
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Reading not found.", 404, corsHeaders);

  if (groupId != null) {
    const group = await env.DB.prepare("SELECT id FROM equipment_groups WHERE id = ? AND building_id = ?")
      .bind(groupId, buildingId)
      .first();
    if (!group) return jsonError("Machine not found.", 404, corsHeaders);
  }

  // Only board_sort_order moves here -- sort_order (the original
  // scanned/created order a superintendent actually follows) is
  // deliberately untouched. Dragging a reading between machines still
  // updates equipment_group_id for real, since that's a genuine "this
  // belongs to a different machine" correction, not just cosmetic
  // board arrangement.
  const slots = existing.results.map((r) => r.board_sort_order).sort((a, b) => a - b);
  const statements = orderedTagIds.map((tagId, index) =>
    env.DB.prepare("UPDATE inspection_tags SET equipment_group_id = ?, board_sort_order = ? WHERE id = ?").bind(groupId, slots[index], tagId),
  );
  await env.DB.batch(statements);
  return jsonOk({ ok: true }, corsHeaders);
}

// Adding a single new reading to an already-live checklist -- the AI
// checklist build (handleSaveTags) is a once-only bulk pass; this is for
// "we added a gauge, add one more line" without redoing the whole thing.
export async function handleCreateTag(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const systemName = String(body.systemName || "").trim();
  const tagNo = body.tagNo != null ? String(body.tagNo).trim() || null : null;
  const readingType = String(body.readingType || "").trim();
  const unit = body.unit != null ? String(body.unit).trim() || null : null;
  const groupId = body.groupId == null || body.groupId === "" ? null : Number.parseInt(body.groupId, 10);
  const requestedValueType = ["numeric", "on_off", "hoa", "open_closed"].includes(body.valueType) ? body.valueType : "numeric";

  if (!systemName || !readingType) return jsonError("A system and a reading are both required.", 400, corsHeaders);
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Building not found.", 404, corsHeaders);

  if (groupId != null) {
    const group = await env.DB.prepare("SELECT id FROM equipment_groups WHERE id = ? AND building_id = ?")
      .bind(groupId, buildingId)
      .first();
    if (!group) return jsonError("Machine not found.", 404, corsHeaders);
  }

  // Same hard rule as everywhere else a reading gets typed or edited --
  // see handleUpdateTag below and worker/buildings.js.
  const isSprinkler = /sprinkler/i.test(`${tagNo || ""} ${readingType}`);
  const valueType = isSprinkler ? "open_closed" : requestedValueType;

  // A brand new reading has no "original scan" position of its own, so
  // it's simply appended after everything else that currently exists --
  // it still lands correctly in a superintendent's walkthrough because
  // command mode groups by machine first (equipment_group_id) before
  // falling back to this sort_order as a tiebreaker, so it shows up
  // alongside its machine's other readings regardless of this number's
  // absolute size. board_sort_order starts equal to it (appended at the
  // end on the board too), independently movable from there on.
  const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM inspection_tags WHERE building_id = ?")
    .bind(buildingId)
    .first();
  const newOrder = (max?.m ?? -1) + 1;
  const inserted = await env.DB.prepare(
    "INSERT INTO inspection_tags (building_id, system_name, tag_no, reading_type, unit, answer_kind, equipment_group_id, sort_order, board_sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(buildingId, systemName, tagNo, readingType, unit, valueType, groupId, newOrder, newOrder)
    .run();

  return jsonOk({ ok: true, tagId: inserted.meta.last_row_id, valueType }, corsHeaders);
}

// Editing a reading after the checklist's already live -- a manager fixing
// a mistyped label or an AI misread, not part of the once-only initial
// checklist build (handleSaveTags).
export async function handleUpdateTag(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const tagId = Number.parseInt(body.tagId, 10);
  const systemName = String(body.systemName || "").trim();
  const tagNo = body.tagNo != null ? String(body.tagNo).trim() || null : null;
  const readingType = String(body.readingType || "").trim();
  const unit = body.unit != null ? String(body.unit).trim() || null : null;
  const requestedValueType = ["numeric", "on_off", "hoa", "open_closed"].includes(body.valueType) ? body.valueType : "numeric";

  if (!systemName || !readingType) return jsonError("A system and a reading are both required.", 400, corsHeaders);

  const tag = await env.DB.prepare("SELECT id, building_id FROM inspection_tags WHERE id = ?").bind(tagId).first();
  if (!tag) return jsonError("Reading not found.", 404, corsHeaders);
  if (!(await ownsBuilding(env, session, tag.building_id))) return jsonError("Reading not found.", 404, corsHeaders);

  // Same hard rule as the initial checklist build (worker/buildings.js) --
  // a sprinkler valve's position is always Open/Closed, no matter what
  // gets typed here. Only the reading's own label decides it, not the
  // section it's filed under (see that file for why).
  const isSprinkler = /sprinkler/i.test(`${tagNo || ""} ${readingType}`);
  const valueType = isSprinkler ? "open_closed" : requestedValueType;

  await env.DB.prepare(
    "UPDATE inspection_tags SET system_name = ?, tag_no = ?, reading_type = ?, unit = ?, answer_kind = ? WHERE id = ?",
  )
    .bind(systemName, tagNo, readingType, unit, valueType, tagId)
    .run();

  return jsonOk({ ok: true, valueType }, corsHeaders);
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
