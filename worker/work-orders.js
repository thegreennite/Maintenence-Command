// Work orders: the real data behind the Exception Queue. A Regional
// Manager sees what's open on buildings they registered, plus anything
// assigned to them specifically; an Operations Manager (or Admin) sees
// everything. Either can hand a work order to another manager to actually
// handle -- e.g. a ROM assigning a supply issue to the OM who owns
// inventory.

import { canSeeAllBuildings } from "./access.js";

const CATEGORY_LABELS = {
  inventory: "Inventory",
  chemicals: "Chemicals / supplies",
  schedule: "Schedule question",
  method: "Method / procedure question",
  other: "Other",
};

// Called from worker/inspections.js when a superintendent confirms a
// reading as genuinely abnormal (not a typo) before submitting.
export async function createReadingWorkOrder(env, { buildingId, tagId, value, createdBy }) {
  // building_id filter matters here, not just style -- without it a client
  // could point a work order at another building's tag by id.
  const tag = await env.DB.prepare(
    "SELECT tag_no, reading_type, unit FROM inspection_tags WHERE id = ? AND building_id = ?",
  )
    .bind(tagId, buildingId)
    .first();
  if (!tag) return;

  const label = [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ");
  const title = `Abnormal reading: ${label}`;
  const description = `Reported as ${value}${tag.unit ? " " + tag.unit : ""}, confirmed abnormal by the superintendent rather than a mistaken entry.`;

  await env.DB.prepare(
    `INSERT INTO work_orders (building_id, created_by, source, title, description, reading_tag_id, reading_value)
     VALUES (?, ?, 'reading', ?, ?, ?, ?)`,
  )
    .bind(buildingId, createdBy, title, description, tagId, String(value))
    .run();
}

export async function handleFlagIssue(request, session, env, corsHeaders) {
  const buildingId = session.building_id;
  if (!buildingId) return jsonError("No building is assigned to this account yet.", 409, corsHeaders);

  const body = await request.json().catch(() => ({}));
  const category = Object.keys(CATEGORY_LABELS).includes(body.category) ? body.category : "other";
  const description = String(body.description || "").trim();
  if (!description) return jsonError("Describe the issue before submitting.", 400, corsHeaders);

  await env.DB.prepare(
    `INSERT INTO work_orders (building_id, created_by, source, category, title, description)
     VALUES (?, ?, 'flagged', ?, ?, ?)`,
  )
    .bind(buildingId, session.id, category, CATEGORY_LABELS[category], description)
    .run();

  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleManagerWorkOrders(session, env, corsHeaders) {
  const scoped = canSeeAllBuildings(session);
  const result = await env.DB.prepare(
    `SELECT w.id, w.source, w.category, w.title, w.description, w.reading_value, w.status,
       w.created_at, w.resolved_at, w.assigned_to, b.name AS building_name, b.id AS building_id,
       u.full_name AS reported_by, assignee.full_name AS assigned_to_name
     FROM work_orders w
     JOIN buildings b ON b.id = w.building_id
     LEFT JOIN users u ON u.id = w.created_by
     LEFT JOIN users assignee ON assignee.id = w.assigned_to
     WHERE ${scoped ? "1=1" : "(b.created_by = ? OR w.assigned_to = ?)"}
     ORDER BY w.status ASC, w.created_at DESC
     LIMIT 50`,
  )
    .bind(...(scoped ? [] : [session.id, session.id]))
    .all();
  return jsonOk({ workOrders: result.results }, corsHeaders);
}

async function findVisibleWorkOrder(env, session, workOrderId) {
  const scoped = canSeeAllBuildings(session);
  if (scoped) {
    return env.DB.prepare("SELECT w.id, w.building_id FROM work_orders w WHERE w.id = ?").bind(workOrderId).first();
  }
  return env.DB.prepare(
    `SELECT w.id, w.building_id FROM work_orders w JOIN buildings b ON b.id = w.building_id
     WHERE w.id = ? AND (b.created_by = ? OR w.assigned_to = ?)`,
  )
    .bind(workOrderId, session.id, session.id)
    .first();
}

export async function handleResolveWorkOrder(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const workOrderId = Number.parseInt(body.workOrderId, 10);

  const workOrder = await findVisibleWorkOrder(env, session, workOrderId);
  if (!workOrder) return jsonError("Work order not found.", 404, corsHeaders);

  await env.DB.prepare(
    "UPDATE work_orders SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ?",
  )
    .bind(session.id, workOrderId)
    .run();

  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleAssignWorkOrder(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const workOrderId = Number.parseInt(body.workOrderId, 10);
  const assigneeId = Number.parseInt(body.assigneeId, 10);

  const workOrder = await findVisibleWorkOrder(env, session, workOrderId);
  if (!workOrder) return jsonError("Work order not found.", 404, corsHeaders);

  const assignee = await env.DB.prepare(
    "SELECT id FROM users WHERE id = ? AND role IN ('regional_manager', 'admin') AND is_active = 1",
  )
    .bind(assigneeId)
    .first();
  if (!assignee) return jsonError("That person can't be assigned work orders.", 400, corsHeaders);

  await env.DB.prepare("UPDATE work_orders SET assigned_to = ?, assigned_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(assigneeId, workOrderId)
    .run();

  return jsonOk({ ok: true }, corsHeaders);
}

// Who can a manager hand a work order to -- every other manager/OM/admin,
// for the "assign to..." picker.
export async function handleAssignableUsers(session, env, corsHeaders) {
  const result = await env.DB.prepare(
    `SELECT id, full_name, job_title, role, building_access FROM users
     WHERE role IN ('regional_manager', 'admin') AND is_active = 1 AND id != ?
     ORDER BY full_name`,
  )
    .bind(session.id)
    .all();
  return jsonOk({ users: result.results }, corsHeaders);
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
