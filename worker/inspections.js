// Phase 2: manual inspection entry. No AI, no photos yet (that's Phase 5) —
// just prove submit -> save -> view against a real building and a real
// checklist pulled from an actual Forest Hill inspection sheet.

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function loadTags(env, buildingId) {
  const result = await env.DB.prepare(
    `SELECT t.id, t.system_name, t.tag_no, t.reading_type, t.unit, t.sort_order, t.value_type,
       p.min_value, p.max_value, p.expected_value
     FROM inspection_tags t
     LEFT JOIN inspection_parameters p ON p.tag_id = t.id
     WHERE t.building_id = ? ORDER BY t.sort_order`,
  )
    .bind(buildingId)
    .all();
  // Included so the app can nudge "does that look right?" the moment a
  // superintendent types something outside the expected range, before it
  // ever reaches the manager — same normal-range info a technician would
  // reference off a spec sheet, not something worth hiding from them.
  return result.results.map((row) => ({
    id: row.id,
    system_name: row.system_name,
    tag_no: row.tag_no,
    reading_type: row.reading_type,
    unit: row.unit,
    sort_order: row.sort_order,
    value_type: row.value_type,
    parameter:
      row.min_value != null || row.max_value != null || row.expected_value != null
        ? { min: row.min_value, max: row.max_value, expected: row.expected_value }
        : null,
  }));
}

async function loadSubmission(env, buildingId, date) {
  const submission = await env.DB.prepare(
    `SELECT id, status, started_at, submitted_at, notes
     FROM inspection_submissions WHERE building_id = ? AND inspection_date = ?`,
  )
    .bind(buildingId, date)
    .first();
  if (!submission) return { submission: null, readings: {} };

  const readings = await env.DB.prepare(
    `SELECT tag_id, value FROM inspection_readings WHERE submission_id = ?`,
  )
    .bind(submission.id)
    .all();
  const readingsByTag = {};
  for (const row of readings.results) readingsByTag[row.tag_id] = row.value;
  return { submission, readings: readingsByTag };
}

export async function handleInspectionToday(session, env, corsHeaders) {
  const buildingId = session.building_id;
  if (!buildingId) {
    return jsonError("No building is assigned to this account yet.", 409, corsHeaders);
  }

  const [building, tags, { submission, readings }] = await Promise.all([
    env.DB.prepare("SELECT id, name, region, inspection_days, status FROM buildings WHERE id = ?")
      .bind(buildingId)
      .first(),
    loadTags(env, buildingId),
    loadSubmission(env, buildingId, today()),
  ]);

  if (building?.status !== "active") {
    return jsonError(
      "This building is still being set up by your operations manager and isn't live yet.",
      409,
      corsHeaders,
    );
  }

  return jsonOk(
    {
      building,
      date: today(),
      tags,
      status: submission?.status || "not_started",
      startedAt: submission?.started_at || null,
      submittedAt: submission?.submitted_at || null,
      notes: submission?.notes || "",
      readings,
    },
    corsHeaders,
  );
}

async function upsertDraft(session, env, { notes, readings }) {
  const buildingId = session.building_id;
  const date = today();

  const building = await env.DB.prepare("SELECT status FROM buildings WHERE id = ?").bind(buildingId).first();
  if (building?.status !== "active") {
    const err = new Error("This building isn't live yet.");
    err.status = 409;
    throw err;
  }

  const existing = await env.DB.prepare(
    `SELECT id, status FROM inspection_submissions WHERE building_id = ? AND inspection_date = ?`,
  )
    .bind(buildingId, date)
    .first();

  if (existing?.status === "submitted") {
    const err = new Error("Today's inspection was already submitted and can't be edited.");
    err.status = 409;
    throw err;
  }

  let submissionId = existing?.id;
  if (!submissionId) {
    const inserted = await env.DB.prepare(
      `INSERT INTO inspection_submissions (building_id, superintendent_id, inspection_date, status, notes)
       VALUES (?, ?, ?, 'draft', ?)`,
    )
      .bind(buildingId, session.id, date, notes ?? "")
      .run();
    submissionId = inserted.meta.last_row_id;
  } else {
    await env.DB.prepare("UPDATE inspection_submissions SET notes = ? WHERE id = ?")
      .bind(notes ?? "", submissionId)
      .run();
  }

  const validTags = await loadTags(env, buildingId);
  const validTagIds = new Set(validTags.map((tag) => tag.id));
  const statements = [];
  for (const [tagId, value] of Object.entries(readings || {})) {
    const id = Number.parseInt(tagId, 10);
    if (!validTagIds.has(id)) continue;
    statements.push(
      env.DB.prepare(
        `INSERT INTO inspection_readings (submission_id, tag_id, value) VALUES (?, ?, ?)
         ON CONFLICT (submission_id, tag_id) DO UPDATE SET value = excluded.value`,
      ).bind(submissionId, id, String(value ?? "")),
    );
  }
  if (statements.length) await env.DB.batch(statements);

  return submissionId;
}

export async function handleInspectionSave(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  try {
    await upsertDraft(session, env, body);
  } catch (error) {
    if (error.status) return jsonError(error.message, error.status, corsHeaders);
    throw error;
  }
  return handleInspectionToday(session, env, corsHeaders);
}

export async function handleInspectionSubmit(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  let submissionId;
  try {
    submissionId = await upsertDraft(session, env, body);
  } catch (error) {
    if (error.status) return jsonError(error.message, error.status, corsHeaders);
    throw error;
  }

  await env.DB.prepare(
    `UPDATE inspection_submissions SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?`,
  )
    .bind(submissionId)
    .run();

  return handleInspectionToday(session, env, corsHeaders);
}

function jsonOk(data, headers) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: withJsonHeaders(headers),
  });
}

function jsonError(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: withJsonHeaders(headers),
  });
}

function withJsonHeaders(headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return responseHeaders;
}
