// Building sharing: an Operations Manager can grant a specific Regional
// Manager full access to a building that ROM didn't personally register,
// at the OM's discretion. Grant-only by OM/admin (canSeeAllBuildings) --
// a plain ROM can't share a building they don't fully control themselves.

import { canSeeAllBuildings, ownedOrSharedSql } from "./access.js";

function requireOm(session, corsHeaders) {
  if (!canSeeAllBuildings(session)) {
    return jsonError("Only an Operations Manager or Administrator can share a building.", 403, corsHeaders);
  }
  return null;
}

export async function handleListRoms(session, env, corsHeaders) {
  const deny = requireOm(session, corsHeaders);
  if (deny) return deny;

  const result = await env.DB.prepare(
    `SELECT id, full_name, job_title, region FROM users
     WHERE role = 'regional_manager' AND building_access = 'own' AND status = 'active' AND is_active = 1
     ORDER BY full_name`,
  ).all();
  return jsonOk({ roms: result.results }, corsHeaders);
}

export async function handleBuildingSharing(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  const scoped = canSeeAllBuildings(session);
  const building = scoped
    ? await env.DB.prepare("SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL").bind(buildingId).first()
    : await env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL AND ${ownedOrSharedSql("buildings")}`)
        .bind(buildingId, session.id, session.id)
        .first();
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const result = await env.DB.prepare(
    `SELECT bm.id, bm.user_id, u.full_name, u.job_title, bm.granted_at, granter.full_name AS granted_by_name
     FROM building_managers bm
     JOIN users u ON u.id = bm.user_id
     LEFT JOIN users granter ON granter.id = bm.granted_by
     WHERE bm.building_id = ?
     ORDER BY bm.granted_at DESC`,
  )
    .bind(buildingId)
    .all();
  return jsonOk({ shares: result.results }, corsHeaders);
}

export async function handleShareBuilding(request, session, env, corsHeaders) {
  const deny = requireOm(session, corsHeaders);
  if (deny) return deny;

  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const userId = Number.parseInt(body.userId, 10);

  const building = await env.DB.prepare("SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL").bind(buildingId).first();
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const rom = await env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND role = 'regional_manager' AND is_active = 1",
  )
    .bind(userId)
    .first();
  if (!rom) return jsonError("That person can't be granted building access.", 400, corsHeaders);

  await env.DB.prepare(
    `INSERT INTO building_managers (building_id, user_id, granted_by) VALUES (?, ?, ?)
     ON CONFLICT (building_id, user_id) DO NOTHING`,
  )
    .bind(buildingId, userId, session.id)
    .run();

  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleUnshareBuilding(request, session, env, corsHeaders) {
  const deny = requireOm(session, corsHeaders);
  if (deny) return deny;

  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const userId = Number.parseInt(body.userId, 10);

  await env.DB.prepare("DELETE FROM building_managers WHERE building_id = ? AND user_id = ?").bind(buildingId, userId).run();
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
