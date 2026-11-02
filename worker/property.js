// Property Manager view: read-only, one building. What a PM needs at a glance --
// is today's inspection done, how the last two weeks went, which readings were
// outside normal (with the super's answer and remark), and every message the
// superintendent sent up (issues they flagged, observations, abnormal readings).
//
// "Outcome" comes from what was recorded at submit (inspection_readings.deviation,
// see worker/deviation.js), so it matches the Friday report: a reading the super
// called abnormal makes the day Abnormal; anything else outside normal makes it
// Needs a look.

import { remarksForSubmissions } from "./remarks.js";
import { readingText } from "../shared/reading-unit.js";

const DAYS_SHOWN = 14;

const parse = (json) => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};

export async function handlePropertyInspections(request, session, env, corsHeaders) {
  const buildingId = session.building_id;
  if (!buildingId) {
    return jsonError("No building is assigned to this account yet.", 409, corsHeaders);
  }

  const [building, tagCount, submissions, messages] = await Promise.all([
    env.DB.prepare("SELECT id, name, region FROM buildings WHERE id = ?").bind(buildingId).first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM inspection_tags WHERE building_id = ?").bind(buildingId).first(),
    env.DB.prepare(
      `SELECT s.id, s.inspection_date, s.status, s.started_at, s.submitted_at, u.full_name AS author
       FROM inspection_submissions s LEFT JOIN users u ON u.id = s.superintendent_id
       WHERE s.building_id = ? ORDER BY s.inspection_date DESC LIMIT ${DAYS_SHOWN}`,
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      `SELECT w.id, w.source, w.category, w.title, w.description, w.reading_value, w.status, w.created_at, u.full_name AS reported_by
       FROM work_orders w LEFT JOIN users u ON u.id = w.created_by
       WHERE w.building_id = ? AND w.created_at >= datetime('now', '-60 days')
       ORDER BY w.created_at DESC LIMIT 50`,
    )
      .bind(buildingId)
      .all(),
  ]);
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const subs = submissions.results;
  const ids = subs.map((s) => s.id);
  const [readings, remarks] = ids.length
    ? await Promise.all([
        env.DB.prepare(
          `SELECT r.submission_id, r.tag_id, r.value, r.deviation, t.tag_no, t.reading_type, t.unit, g.name AS group_name
           FROM inspection_readings r JOIN inspection_tags t ON t.id = r.tag_id
           LEFT JOIN equipment_groups g ON g.id = t.equipment_group_id
           WHERE r.submission_id IN (${ids.map(() => "?").join(",")})`,
        )
          .bind(...ids)
          .all(),
        remarksForSubmissions(env, ids).catch(() => new Map()),
      ])
    : [{ results: [] }, new Map()];

  const bySub = new Map(subs.map((s) => [s.id, { filled: 0, flagged: 0, abnormal: 0 }]));
  const dateOf = new Map(subs.map((s) => [s.id, s.inspection_date]));
  const outside = [];
  for (const row of readings.results) {
    const c = bySub.get(row.submission_id);
    if (String(row.value ?? "").trim()) c.filled += 1;
    const deviation = parse(row.deviation);
    if (!deviation) continue;
    c.flagged += 1;
    if (deviation.ack === "abnormal") c.abnormal += 1;
    outside.push({
      date: dateOf.get(row.submission_id),
      where: [row.group_name, [row.tag_no, row.reading_type].filter(Boolean).join(" — ")].filter(Boolean).join(" · "),
      value: readingText(row.value, row.unit),
      detail: deviation.detail || "",
      answer: deviation.ack || null,
      remark: remarks.get(`${row.submission_id}|${row.tag_id}`) || "",
    });
  }
  outside.sort((a, b) => b.date.localeCompare(a.date) || (a.answer === "abnormal" ? -1 : 1));

  const days = subs.map((s) => {
    const c = bySub.get(s.id);
    const outcome = s.status !== "submitted" ? "not_evaluated" : c.abnormal ? "abnormal" : c.flagged ? "needs_look" : "normal";
    return {
      date: s.inspection_date,
      status: s.status,
      startedAt: s.started_at,
      submittedAt: s.submitted_at,
      author: s.author,
      outcome,
      counts: { filled: c.filled, flagged: c.flagged, abnormal: c.abnormal },
    };
  });

  const todayIso = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

  return jsonOk(
    {
      building,
      totalReadings: tagCount?.c || 0,
      today: days.find((d) => d.date === todayIso) || null,
      days,
      outside: outside.slice(0, 40),
      messages: messages.results,
    },
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
