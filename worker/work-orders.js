// Work orders: the real data behind what used to be the mock Exception
// Queue. Manager-only tracking -- no assignment, the manager just sees
// what's open per building and marks it resolved.

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
  const result = await env.DB.prepare(
    `SELECT w.id, w.source, w.category, w.title, w.description, w.reading_value, w.status,
       w.created_at, w.resolved_at, b.name AS building_name, b.id AS building_id,
       u.full_name AS reported_by
     FROM work_orders w
     JOIN buildings b ON b.id = w.building_id
     LEFT JOIN users u ON u.id = w.created_by
     WHERE b.region = ?
     ORDER BY w.status ASC, w.created_at DESC
     LIMIT 50`,
  )
    .bind(session.region)
    .all();
  return jsonOk({ workOrders: result.results }, corsHeaders);
}

export async function handleResolveWorkOrder(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const workOrderId = Number.parseInt(body.workOrderId, 10);

  const workOrder = await env.DB.prepare(
    `SELECT w.id FROM work_orders w JOIN buildings b ON b.id = w.building_id
     WHERE w.id = ? AND b.region = ?`,
  )
    .bind(workOrderId, session.region)
    .first();
  if (!workOrder) return jsonError("Work order not found.", 404, corsHeaders);

  await env.DB.prepare(
    "UPDATE work_orders SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = ? WHERE id = ?",
  )
    .bind(session.id, workOrderId)
    .run();

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
