// Building notices board: short instructions a manager posts for whoever
// covers that building. Editable set (add/remove), not a message thread.

import { canSeeAllBuildings, ownedOrSharedSql } from "./access.js";

async function ownsBuilding(env, session, buildingId) {
  if (canSeeAllBuildings(session)) {
    return env.DB.prepare("SELECT id FROM buildings WHERE id = ?").bind(buildingId).first();
  }
  return env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND ${ownedOrSharedSql("buildings")}`)
    .bind(buildingId, session.id, session.id)
    .first();
}

export async function handleCreateNotice(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const message = String(body.message || "").trim();
  if (!message) return jsonError("A message is required.", 400, corsHeaders);

  const building = await ownsBuilding(env, session, buildingId);
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  await env.DB.prepare("INSERT INTO building_notices (building_id, created_by, message) VALUES (?, ?, ?)")
    .bind(buildingId, session.id, message)
    .run();

  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleDeleteNotice(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const noticeId = Number.parseInt(body.noticeId, 10);

  const notice = await env.DB.prepare(
    `SELECT n.id, n.building_id FROM building_notices n WHERE n.id = ?`,
  )
    .bind(noticeId)
    .first();
  if (!notice) return jsonError("Notice not found.", 404, corsHeaders);

  const building = await ownsBuilding(env, session, notice.building_id);
  if (!building) return jsonError("Notice not found.", 404, corsHeaders);

  await env.DB.prepare("DELETE FROM building_notices WHERE id = ?").bind(noticeId).run();
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
