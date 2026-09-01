// Phase 4: Property Manager read-only view. Deliberately minimal per the
// original spec — start time, submit time, and the day's outcome. Reuses
// Phase 3's flagging logic against the building's current parameters so
// "outcome" means the same thing here as it does on the Manager's panel.

import { flagFor } from "./manager.js";

export async function handlePropertyInspections(request, session, env, corsHeaders) {
  const buildingId = session.building_id;
  if (!buildingId) {
    return jsonError("No building is assigned to this account yet.", 409, corsHeaders);
  }

  const [building, tags, parameters, submissions] = await Promise.all([
    env.DB.prepare("SELECT id, name, region FROM buildings WHERE id = ?").bind(buildingId).first(),
    env.DB.prepare(
      "SELECT id, answer_kind AS value_type FROM inspection_tags WHERE building_id = ?",
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      `SELECT p.tag_id, p.min_value, p.max_value, p.expected_value
       FROM inspection_parameters p
       JOIN inspection_tags t ON t.id = p.tag_id
       WHERE t.building_id = ?`,
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      `SELECT id, inspection_date, status, started_at, submitted_at
       FROM inspection_submissions WHERE building_id = ?
       ORDER BY inspection_date DESC LIMIT 14`,
    )
      .bind(buildingId)
      .all(),
  ]);

  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const tagById = new Map(tags.results.map((tag) => [tag.id, tag]));
  const parameterByTag = new Map(parameters.results.map((row) => [row.tag_id, row]));

  const days = await Promise.all(
    submissions.results.map(async (submission) => {
      const readings = await env.DB.prepare(
        "SELECT tag_id, value FROM inspection_readings WHERE submission_id = ?",
      )
        .bind(submission.id)
        .all();

      const counts = { green: 0, yellow: 0, red: 0 };
      for (const reading of readings.results) {
        const tag = tagById.get(reading.tag_id);
        const parameter = parameterByTag.get(reading.tag_id);
        const flag = tag ? flagFor(tag, reading.value, parameter) : null;
        if (flag) counts[flag] += 1;
      }

      const outcome = counts.red > 0 ? "abnormal" : counts.yellow > 0 ? "needs_look" : counts.green > 0 ? "normal" : "not_evaluated";

      return {
        date: submission.inspection_date,
        status: submission.status,
        startedAt: submission.started_at,
        submittedAt: submission.submitted_at,
        outcome,
        counts,
      };
    }),
  );

  return jsonOk({ building, days }, corsHeaders);
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
