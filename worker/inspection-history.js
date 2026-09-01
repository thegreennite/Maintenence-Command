// Inspection history for the building world page — submitted daily
// inspections organized into weekly folders (the frontend groups by ISO
// week; this just returns dates in order) and a full-detail endpoint for
// rendering one day as a PDF client-side.

import { canSeeAllBuildings } from "./access.js";

async function ownsBuilding(env, session, buildingId) {
  if (canSeeAllBuildings(session)) {
    return env.DB.prepare("SELECT id, name FROM buildings WHERE id = ?").bind(buildingId).first();
  }
  return env.DB.prepare("SELECT id, name FROM buildings WHERE id = ? AND created_by = ?").bind(buildingId, session.id).first();
}

export async function handleInspectionHistory(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  if (!(await ownsBuilding(env, session, buildingId))) return jsonError("Building not found.", 404, corsHeaders);

  const result = await env.DB.prepare(
    `SELECT s.inspection_date, s.submitted_at, u.full_name AS superintendent_name,
       (SELECT COUNT(*) FROM inspection_readings r WHERE r.submission_id = s.id) AS reading_count
     FROM inspection_submissions s
     LEFT JOIN users u ON u.id = s.superintendent_id
     WHERE s.building_id = ? AND s.status = 'submitted'
     ORDER BY s.inspection_date DESC`,
  )
    .bind(buildingId)
    .all();

  return jsonOk({ submissions: result.results }, corsHeaders);
}

export async function handleInspectionDetail(request, session, env, corsHeaders) {
  const url = new URL(request.url);
  const buildingId = Number.parseInt(url.searchParams.get("buildingId"), 10);
  const date = url.searchParams.get("date") || "";
  const building = await ownsBuilding(env, session, buildingId);
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const submission = await env.DB.prepare(
    `SELECT s.id, s.inspection_date, s.submitted_at, s.notes, u.full_name AS superintendent_name
     FROM inspection_submissions s LEFT JOIN users u ON u.id = s.superintendent_id
     WHERE s.building_id = ? AND s.inspection_date = ? AND s.status = 'submitted'`,
  )
    .bind(buildingId, date)
    .first();
  if (!submission) return jsonError("No submitted inspection for that date.", 404, corsHeaders);

  const readings = await env.DB.prepare(
    `SELECT t.system_name, t.tag_no, t.reading_type, t.unit, t.sort_order, r.value, r.flagged
     FROM inspection_readings r JOIN inspection_tags t ON t.id = r.tag_id
     WHERE r.submission_id = ? ORDER BY t.sort_order`,
  )
    .bind(submission.id)
    .all();

  return jsonOk(
    { building: { id: building.id, name: building.name }, submission, readings: readings.results },
    corsHeaders,
  );
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
