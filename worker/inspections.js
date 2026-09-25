// Phase 2: manual inspection entry. No AI, no photos yet (that's Phase 5) —
// just prove submit -> save -> view against a real building and a real
// checklist pulled from an actual Forest Hill inspection sheet.

import { createReadingWorkOrder } from "./work-orders.js";

// Toronto time, not UTC -- an inspection "day" should turn over at
// midnight ET, not at 8pm local when UTC quietly rolls to the next date.
function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

// Cheap trend stats from the last 7 days of SUBMITTED readings for numeric
// tags -- lets command mode (and the regular form) flag "this doesn't look
// like what this gauge usually reads" even for tags nobody bothered to set
// a manual min/max on. avg_sq lets us derive stdev without SQLite having a
// native STDDEV function: variance = E[x^2] - E[x]^2.
async function loadHistory(env, buildingId, today) {
  const result = await env.DB.prepare(
    `SELECT r.tag_id,
       COUNT(*) AS sample_count,
       AVG(CAST(r.value AS REAL)) AS avg_value,
       AVG(CAST(r.value AS REAL) * CAST(r.value AS REAL)) AS avg_sq,
       MIN(CAST(r.value AS REAL)) AS min_value,
       MAX(CAST(r.value AS REAL)) AS max_value
     FROM inspection_readings r
     JOIN inspection_submissions s ON s.id = r.submission_id
     JOIN inspection_tags t ON t.id = r.tag_id
     WHERE s.building_id = ? AND s.status = 'submitted' AND s.inspection_date >= date(?, '-7 days')
       AND s.inspection_date < ? AND t.answer_kind = 'numeric' AND r.value IS NOT NULL AND TRIM(r.value) != ''
     GROUP BY r.tag_id`,
  )
    .bind(buildingId, today, today)
    .all();

  const byTag = {};
  for (const row of result.results) {
    // A full work-week of real submitted readings before trend-flagging
    // kicks in at all for a tag -- fewer than that isn't enough to know
    // what "normal" even looks like for that specific gauge yet.
    if (row.sample_count < 5) continue;
    const variance = Math.max(row.avg_sq - row.avg_value * row.avg_value, 0);
    byTag[row.tag_id] = {
      count: row.sample_count,
      avg: row.avg_value,
      stdev: Math.sqrt(variance),
      min: row.min_value,
      max: row.max_value,
    };
  }
  return byTag;
}

async function loadTags(env, buildingId) {
  const [result, history] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, t.system_name, t.tag_no, t.reading_type, t.unit, t.sort_order, t.answer_kind AS value_type, t.location_id,
         l.name AS location_name, l.sort_order AS location_sort_order,
         t.equipment_group_id, g.name AS equipment_group_name, g.requires_photo, g.sort_order AS equipment_group_sort_order,
         p.min_value, p.max_value, p.expected_value
       FROM inspection_tags t
       LEFT JOIN inspection_parameters p ON p.tag_id = t.id
       LEFT JOIN building_locations l ON l.id = t.location_id
       LEFT JOIN equipment_groups g ON g.id = t.equipment_group_id
       WHERE t.building_id = ? ORDER BY t.sort_order`,
    )
      .bind(buildingId)
      .all(),
    loadHistory(env, buildingId, today()),
  ]);
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
    location_id: row.location_id,
    location_name: row.location_name,
    location_sort_order: row.location_sort_order,
    equipment_group_id: row.equipment_group_id,
    equipment_group_name: row.equipment_group_name,
    equipment_group_sort_order: row.equipment_group_sort_order,
    // null for a tag with no group at all, not just "doesn't require a
    // photo" -- groupNeedsPhotoNow (src/main.js) only cares about the
    // latter, which is `row.requires_photo === 0`.
    equipment_group_requires_photo: row.equipment_group_id == null ? null : Boolean(row.requires_photo),
    parameter:
      row.min_value != null || row.max_value != null || row.expected_value != null
        ? { min: row.min_value, max: row.max_value, expected: row.expected_value }
        : null,
    history: history[row.id] || null,
  }));
}

async function loadSubmission(env, buildingId, date) {
  const submission = await env.DB.prepare(
    `SELECT id, status, started_at, submitted_at, notes
     FROM inspection_submissions WHERE building_id = ? AND inspection_date = ?`,
  )
    .bind(buildingId, date)
    .first();
  if (!submission) return { submission: null, readings: {}, flags: {}, photoKeys: {}, groupNotes: {}, groupPhotos: {} };

  const [readings, groupNotes, groupPhotos] = await Promise.all([
    env.DB.prepare(`SELECT tag_id, value, flagged, photo_key FROM inspection_readings WHERE submission_id = ?`)
      .bind(submission.id)
      .all(),
    env.DB.prepare(`SELECT equipment_group_id, note FROM group_notes WHERE submission_id = ?`)
      .bind(submission.id)
      .all(),
    env.DB.prepare(`SELECT equipment_group_id, photo_key, captured_at, latitude, longitude FROM group_photos WHERE submission_id = ?`)
      .bind(submission.id)
      .all(),
  ]);
  const readingsByTag = {};
  const flagsByTag = {};
  const photoKeysByTag = {};
  for (const row of readings.results) {
    readingsByTag[row.tag_id] = row.value;
    if (row.flagged) flagsByTag[row.tag_id] = true;
    if (row.photo_key) photoKeysByTag[row.tag_id] = row.photo_key;
  }
  const groupNotesById = {};
  for (const row of groupNotes.results) groupNotesById[row.equipment_group_id] = row.note;
  const groupPhotosById = {};
  for (const row of groupPhotos.results) {
    groupPhotosById[row.equipment_group_id] = {
      photoKey: row.photo_key,
      capturedAt: row.captured_at,
      latitude: row.latitude,
      longitude: row.longitude,
    };
  }
  return {
    submission,
    readings: readingsByTag,
    flags: flagsByTag,
    photoKeys: photoKeysByTag,
    groupNotes: groupNotesById,
    groupPhotos: groupPhotosById,
  };
}

export async function handleInspectionToday(session, env, corsHeaders) {
  const buildingId = session.building_id;
  if (!buildingId) {
    return jsonError("No building is assigned to this account yet.", 409, corsHeaders);
  }

  const [building, tags, { submission, readings, flags, photoKeys, groupNotes, groupPhotos }, notices, recentNotes, recentGroupNotes] = await Promise.all([
    env.DB.prepare("SELECT id, name, region, inspection_days, status, deleted_at FROM buildings WHERE id = ?")
      .bind(buildingId)
      .first(),
    loadTags(env, buildingId),
    loadSubmission(env, buildingId, today()),
    env.DB.prepare(
      `SELECT n.id, n.message, n.created_at, u.full_name AS created_by_name
       FROM building_notices n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.building_id = ? ORDER BY n.created_at DESC`,
    )
      .bind(buildingId)
      .all(),
    // Past daily inspection notes -- whatever a super (or an operations
    // manager reviewing the same building) left behind on a previous
    // day, not just today's own note field.
    env.DB.prepare(
      `SELECT inspection_date, notes, submitted_at FROM inspection_submissions
       WHERE building_id = ? AND notes IS NOT NULL AND TRIM(notes) != '' AND inspection_date != ?
       ORDER BY inspection_date DESC LIMIT 10`,
    )
      .bind(buildingId, today())
      .all(),
    // Per-machine notes left on past days -- the same recent-notes feed
    // an operations manager already sees on their side (worker/buildings.js's
    // handleBuildingDetail), mirrored here so a super sees it too.
    env.DB.prepare(
      `SELECT gn.equipment_group_id, g.name AS group_name, gn.note, gn.updated_at, s.inspection_date
       FROM group_notes gn
       JOIN inspection_submissions s ON s.id = gn.submission_id
       JOIN equipment_groups g ON g.id = gn.equipment_group_id
       WHERE s.building_id = ? ORDER BY s.inspection_date DESC LIMIT 10`,
    )
      .bind(buildingId)
      .all(),
  ]);

  if (building?.status !== "active" || building?.deleted_at) {
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
      flags,
      photoKeys,
      groupNotes,
      groupPhotos,
      notices: notices.results,
      recentNotes: recentNotes.results,
      recentGroupNotes: recentGroupNotes.results,
    },
    corsHeaders,
  );
}

// Shared by upsertDraft (below) and the group-photo upload endpoint --
// both need today's submission row to exist before they can write
// anything against it, and a photo can be the very first thing a super
// does that day, before typing a single reading.
export async function ensureSubmission(session, env) {
  const buildingId = session.building_id;
  const date = today();

  const building = await env.DB.prepare("SELECT status, deleted_at FROM buildings WHERE id = ?").bind(buildingId).first();
  if (building?.status !== "active" || building?.deleted_at) {
    const err = new Error("This building isn't live yet.");
    err.status = 409;
    throw err;
  }

  const existing = await env.DB.prepare(
    `SELECT id, status, locked_partial_at FROM inspection_submissions WHERE building_id = ? AND inspection_date = ?`,
  )
    .bind(buildingId, date)
    .first();

  if (existing?.status === "submitted") {
    const err = new Error("Today's inspection was already submitted and can't be edited.");
    err.status = 409;
    throw err;
  }

  // Normally unreachable -- ensureSubmission only ever looks at today's
  // own date, and the nightly lock cron only ever touches rows strictly
  // before today, so today's row is never locked yet. Guarded anyway:
  // a locked partial day is meant to be frozen history, the same as a
  // submitted one, not something a stray edit call can reopen.
  if (existing?.locked_partial_at) {
    const err = new Error("This day's inspection was locked as incomplete and can't be edited.");
    err.status = 409;
    throw err;
  }

  if (existing?.id) return { submissionId: existing.id, buildingId, date };

  const inserted = await env.DB.prepare(
    `INSERT INTO inspection_submissions (building_id, superintendent_id, inspection_date, status, notes)
     VALUES (?, ?, ?, 'draft', '')`,
  )
    .bind(buildingId, session.id, date)
    .run();
  return { submissionId: inserted.meta.last_row_id, buildingId, date };
}

// Runs off the nightly cron (see worker/index.js's scheduled() and
// wrangler.toml's second cron entry). Any building's inspection that's
// still sitting in 'draft' once its own calendar day has fully passed
// gets stamped locked_partial_at -- whatever readings a superintendent
// did get to stay saved and visible, it just can no longer be edited or
// added to, the same as a real submit locks a finished day. status
// itself is deliberately left as 'draft' rather than introduced as a
// new value -- see the migration's own comment for why (D1 doesn't
// honor PRAGMA foreign_keys=OFF, so a CHECK-constraint rebuild isn't
// safe on this table while inspection_readings/group_notes/group_photos
// reference it).
export async function lockStaleDrafts(env) {
  const cutoff = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const result = await env.DB.prepare(
    `UPDATE inspection_submissions SET locked_partial_at = CURRENT_TIMESTAMP
     WHERE status = 'draft' AND locked_partial_at IS NULL AND inspection_date < ?`,
  )
    .bind(cutoff)
    .run();
  return { locked: result.meta.changes || 0 };
}

async function upsertDraft(session, env, { notes, readings, flags, photoKeys, groupNotes }) {
  const { submissionId, buildingId } = await ensureSubmission(session, env);
  if (notes != null) {
    await env.DB.prepare("UPDATE inspection_submissions SET notes = ? WHERE id = ?")
      .bind(notes ?? "", submissionId)
      .run();
  }

  const validTags = await loadTags(env, buildingId);
  const validTagIds = new Set(validTags.map((tag) => tag.id));
  const readingsMap = readings || {};
  const flagsMap = flags || {};
  const photoKeysMap = photoKeys || {};
  const allTagIds = new Set([
    ...Object.keys(readingsMap).map((id) => Number.parseInt(id, 10)),
    ...Object.keys(flagsMap).map((id) => Number.parseInt(id, 10)),
    ...Object.keys(photoKeysMap).map((id) => Number.parseInt(id, 10)),
  ]);

  // Deliberately column-by-column rather than one blanket upsert: the
  // regular grid form only ever POSTs `readings` (never `flags` or
  // `photoKeys`), so a naive "overwrite everything this call touches"
  // would silently clear a flag command mode had just set the moment
  // anyone saved from the plain form -- confirmed via testing (flag
  // review correctly listed 8 remaining items, but hitting the regular
  // grid's Submit wiped them all and let a still-incomplete inspection
  // through). Each column is only ever touched by a payload that actually
  // mentions it.
  const statements = [];
  for (const id of allTagIds) {
    if (!validTagIds.has(id)) continue;
    const hasReading = Object.hasOwn(readingsMap, id) || Object.hasOwn(readingsMap, String(id));
    const hasFlag = Object.hasOwn(flagsMap, id) || Object.hasOwn(flagsMap, String(id));
    const hasPhoto = Object.hasOwn(photoKeysMap, id) || Object.hasOwn(photoKeysMap, String(id));
    const value = readingsMap[id] ?? readingsMap[String(id)];
    const flagged = (flagsMap[id] ?? flagsMap[String(id)]) ? 1 : 0;
    const photoKey = photoKeysMap[id] ?? photoKeysMap[String(id)] ?? null;

    statements.push(
      env.DB.prepare(
        `INSERT INTO inspection_readings (submission_id, tag_id, value, flagged, photo_key) VALUES (?, ?, ?, 0, NULL)
         ON CONFLICT (submission_id, tag_id) DO NOTHING`,
      ).bind(submissionId, id, hasReading ? String(value ?? "") : ""),
    );
    if (hasReading) {
      statements.push(
        env.DB.prepare(`UPDATE inspection_readings SET value = ? WHERE submission_id = ? AND tag_id = ?`).bind(
          String(value ?? ""),
          submissionId,
          id,
        ),
      );
    }
    if (hasFlag) {
      statements.push(
        env.DB.prepare(`UPDATE inspection_readings SET flagged = ? WHERE submission_id = ? AND tag_id = ?`).bind(
          flagged,
          submissionId,
          id,
        ),
      );
    }
    if (hasPhoto) {
      statements.push(
        env.DB.prepare(`UPDATE inspection_readings SET photo_key = ? WHERE submission_id = ? AND tag_id = ?`).bind(
          photoKey,
          submissionId,
          id,
        ),
      );
    }
  }
  if (statements.length) await env.DB.batch(statements);

  const groupNotesMap = groupNotes || {};
  if (Object.keys(groupNotesMap).length) {
    const validGroups = await env.DB.prepare("SELECT id FROM equipment_groups WHERE building_id = ?").bind(buildingId).all();
    const validGroupIds = new Set(validGroups.results.map((g) => g.id));
    const noteStatements = [];
    for (const [groupIdRaw, note] of Object.entries(groupNotesMap)) {
      const groupId = Number.parseInt(groupIdRaw, 10);
      if (!validGroupIds.has(groupId)) continue;
      const trimmed = String(note ?? "").trim();
      if (!trimmed) {
        noteStatements.push(
          env.DB.prepare("DELETE FROM group_notes WHERE submission_id = ? AND equipment_group_id = ?").bind(submissionId, groupId),
        );
        continue;
      }
      noteStatements.push(
        env.DB.prepare(
          `INSERT INTO group_notes (submission_id, equipment_group_id, note, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT (submission_id, equipment_group_id) DO UPDATE SET note = excluded.note, updated_at = CURRENT_TIMESTAMP`,
        ).bind(submissionId, groupId, trimmed),
      );
    }
    if (noteStatements.length) await env.DB.batch(noteStatements);
  }

  return submissionId;
}

export async function handleInspectionSave(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  try {
    if (body.clearAll === true) {
      // Resolve only this account's current editable inspection. Never delete
      // historical inspections or the original recovery copies in GHL/R2.
      const { submissionId, buildingId, date } = await ensureSubmission(session, env);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM inspection_readings WHERE submission_id = ?').bind(submissionId),
        env.DB.prepare('DELETE FROM group_photos WHERE submission_id = ?').bind(submissionId),
        env.DB.prepare('DELETE FROM group_notes WHERE submission_id = ?').bind(submissionId),
        env.DB.prepare("UPDATE inspection_submissions SET notes = '' WHERE id = ?").bind(submissionId),
        env.DB.prepare("DELETE FROM photos WHERE building_id = ? AND date = ? AND (context = 'inspection' OR context GLOB 'group-[0-9]*' OR context GLOB 'command-[0-9]*')").bind(buildingId, date),
      ]);
    } else {
      await upsertDraft(session, env, body);
    }
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

  // Server-side backstop for command mode's "flag for later" gate -- the
  // client should never let a submit through with flags still open, but
  // don't trust that alone.
  const stillFlagged = await env.DB.prepare(
    `SELECT t.tag_no, t.reading_type FROM inspection_readings r
     JOIN inspection_tags t ON t.id = r.tag_id
     WHERE r.submission_id = ? AND r.flagged = 1`,
  )
    .bind(submissionId)
    .all();
  if (stillFlagged.results.length) {
    const labels = stillFlagged.results.map((t) => [t.tag_no, t.reading_type].filter(Boolean).join(" — ")).join(", ");
    return jsonError(`Resolve these flagged readings before submitting: ${labels}`, 409, corsHeaders);
  }

  // Every equipment group actually in use on this building's checklist
  // needs its own timestamped proof photo for today before the day can
  // be closed out -- see migrations/0017_group_photos.sql for why (it's
  // an anti-fraud measure, not an AI feature, so this applies to every
  // superintendent, not just the beta tester) -- unless a manager has
  // explicitly turned that off for a particular machine (migrations/
  // 0022_group_requires_photo.sql).
  const missingGroupPhotos = await env.DB.prepare(
    `SELECT g.id, g.name FROM equipment_groups g
     WHERE g.building_id = ? AND g.requires_photo = 1
       AND EXISTS (SELECT 1 FROM inspection_tags t WHERE t.equipment_group_id = g.id)
       AND NOT EXISTS (SELECT 1 FROM group_photos p WHERE p.submission_id = ? AND p.equipment_group_id = g.id)
     ORDER BY g.sort_order, g.name`,
  )
    .bind(session.building_id, submissionId)
    .all();
  if (missingGroupPhotos.results.length) {
    const names = missingGroupPhotos.results.map((g) => g.name).join(", ");
    return jsonError(`Take a timestamped photo of these before submitting: ${names}`, 409, corsHeaders);
  }

  await env.DB.prepare(
    `UPDATE inspection_submissions SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP WHERE id = ?`,
  )
    .bind(submissionId)
    .run();

  const confirmedAbnormalTagIds = Array.isArray(body.confirmedAbnormalTagIds) ? body.confirmedAbnormalTagIds : [];
  for (const rawTagId of confirmedAbnormalTagIds) {
    const tagId = Number.parseInt(rawTagId, 10);
    const value = body.readings?.[tagId] ?? body.readings?.[String(tagId)];
    if (!tagId || value == null) continue;
    await createReadingWorkOrder(env, { buildingId: session.building_id, tagId, value, createdBy: session.id });
  }

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
