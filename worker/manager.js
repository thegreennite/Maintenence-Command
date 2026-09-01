// Phase 3: Regional Manager view of a building's inspection, with optional
// per-reading parameters and green/yellow/red flagging computed against
// them. Parameters are opt-in — a tag with none set is just "not evaluated".

import { canSeeAllBuildings } from "./access.js";

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

// A reading is flagged red the moment it's outside the normal range, but
// gets a yellow "needs a look" band just past the edge before that, sized
// to 10% of the range width (minimum 1 unit) — a defensible starting point,
// not a precisely specified rule; adjust the multiplier below if a manager
// wants tighter or looser tolerance once this is in real use.
export function flagFor(tag, rawValue, parameter) {
  if (!parameter || rawValue == null || rawValue === "") return null;

  if (tag.value_type === "on_off" || tag.value_type === "hoa") {
    if (!parameter.expected_value) return null;
    return rawValue.trim().toLowerCase() === parameter.expected_value.trim().toLowerCase()
      ? "green"
      : "red";
  }

  if (parameter.min_value == null || parameter.max_value == null) return null;
  const num = Number.parseFloat(rawValue);
  if (Number.isNaN(num)) return "red";

  const { min_value: min, max_value: max } = parameter;
  if (num >= min && num <= max) return "green";

  const buffer = Math.max((max - min) * 0.1, 1);
  if (num >= min - buffer && num <= max + buffer) return "yellow";
  return "red";
}

async function resolveBuilding(env, session, buildingId) {
  const scoped = canSeeAllBuildings(session);
  if (buildingId) {
    if (scoped) {
      return env.DB.prepare("SELECT id, name, region, inspection_days FROM buildings WHERE id = ?")
        .bind(buildingId)
        .first();
    }
    return env.DB.prepare("SELECT id, name, region, inspection_days FROM buildings WHERE id = ? AND created_by = ?")
      .bind(buildingId, session.id)
      .first();
  }
  if (scoped) {
    return env.DB.prepare("SELECT id, name, region, inspection_days FROM buildings ORDER BY id LIMIT 1").first();
  }
  return env.DB.prepare("SELECT id, name, region, inspection_days FROM buildings WHERE created_by = ? ORDER BY id LIMIT 1")
    .bind(session.id)
    .first();
}

export async function handleManagerSuperintendents(session, env, corsHeaders) {
  const scoped = canSeeAllBuildings(session);
  const result = await env.DB.prepare(
    `SELECT u.id, u.full_name, b.name AS building_name
     FROM users u JOIN buildings b ON b.id = u.building_id
     WHERE u.role = 'superintendent' AND u.is_active = 1 ${scoped ? "" : "AND b.created_by = ?"}
     ORDER BY u.full_name`,
  )
    .bind(...(scoped ? [] : [session.id]))
    .all();
  return jsonOk({ superintendents: result.results }, corsHeaders);
}

export async function handleManagerInspection(request, session, env, corsHeaders) {
  const url = new URL(request.url);
  const buildingId = url.searchParams.get("buildingId");
  const date = url.searchParams.get("date") || today();

  const building = await resolveBuilding(env, session, buildingId ? Number.parseInt(buildingId, 10) : null);
  if (!building) return jsonError("No building found in your region.", 404, corsHeaders);

  const [tags, parameters, submission] = await Promise.all([
    env.DB.prepare(
      `SELECT id, system_name, tag_no, reading_type, unit, reading_kind AS value_type, sort_order
       FROM inspection_tags WHERE building_id = ? ORDER BY sort_order`,
    )
      .bind(building.id)
      .all(),
    env.DB.prepare(
      `SELECT p.tag_id, p.min_value, p.max_value, p.expected_value
       FROM inspection_parameters p
       JOIN inspection_tags t ON t.id = p.tag_id
       WHERE t.building_id = ?`,
    )
      .bind(building.id)
      .all(),
    env.DB.prepare(
      `SELECT id, status, started_at, submitted_at, notes FROM inspection_submissions
       WHERE building_id = ? AND inspection_date = ?`,
    )
      .bind(building.id, date)
      .first(),
  ]);

  const parametersByTag = {};
  for (const row of parameters.results) parametersByTag[row.tag_id] = row;

  let readingsByTag = {};
  if (submission) {
    const readings = await env.DB.prepare(
      "SELECT tag_id, value FROM inspection_readings WHERE submission_id = ?",
    )
      .bind(submission.id)
      .all();
    for (const row of readings.results) readingsByTag[row.tag_id] = row.value;
  }

  const tagsWithFlags = tags.results.map((tag) => {
    const parameter = parametersByTag[tag.id] || null;
    const value = readingsByTag[tag.id] ?? null;
    return {
      ...tag,
      value,
      parameter: parameter
        ? { min: parameter.min_value, max: parameter.max_value, expected: parameter.expected_value }
        : null,
      flag: flagFor(tag, value, parameter),
    };
  });

  return jsonOk(
    {
      building,
      date,
      status: submission?.status || "not_started",
      startedAt: submission?.started_at || null,
      submittedAt: submission?.submitted_at || null,
      notes: submission?.notes || "",
      tags: tagsWithFlags,
    },
    corsHeaders,
  );
}

export async function handleManagerParametersSave(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const building = await resolveBuilding(env, session, buildingId);
  if (!building) return jsonError("No building found in your region.", 404, corsHeaders);

  const validTags = await env.DB.prepare(
    "SELECT id, reading_kind AS value_type FROM inspection_tags WHERE building_id = ?",
  )
    .bind(building.id)
    .all();
  const tagTypeById = new Map(validTags.results.map((tag) => [tag.id, tag.value_type]));

  const statements = [];
  for (const entry of Array.isArray(body.parameters) ? body.parameters : []) {
    const tagId = Number.parseInt(entry.tagId, 10);
    const valueType = tagTypeById.get(tagId);
    if (!valueType) continue;

    const min = valueType === "numeric" && entry.min !== "" && entry.min != null ? Number.parseFloat(entry.min) : null;
    const max = valueType === "numeric" && entry.max !== "" && entry.max != null ? Number.parseFloat(entry.max) : null;
    const expected = (valueType === "on_off" || valueType === "hoa") && entry.expected ? String(entry.expected) : null;

    if (min == null && max == null && !expected) {
      statements.push(env.DB.prepare("DELETE FROM inspection_parameters WHERE tag_id = ?").bind(tagId));
      continue;
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO inspection_parameters (tag_id, min_value, max_value, expected_value, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (tag_id) DO UPDATE SET
           min_value = excluded.min_value,
           max_value = excluded.max_value,
           expected_value = excluded.expected_value,
           updated_by = excluded.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(tagId, min, max, expected, session.id),
    );
  }
  if (statements.length) await env.DB.batch(statements);

  const passthroughRequest = new Request(
    `${new URL(request.url).origin}/api/manager/inspection?buildingId=${building.id}`,
  );
  return handleManagerInspection(passthroughRequest, session, env, corsHeaders);
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
