// Schedules: a manager uploads a building's cleaning/maintenance schedule,
// AI turns it into recurring tasks, the manager reviews it (choosing
// per-task whether times are enforced and how many proof photos are
// required), and each assigned cleaner / superintendent gets a checklist
// for the day. Checking a task off means taking photos first -- one
// general shot and then several detail shots by default -- and the task
// only counts as done once the required photos are in.
//
// Times are Toronto time (same as inspections: a "day" turns over at
// midnight ET). Tasks are never hard-deleted; completed days point at
// them as proof of work.

import { storePhoto } from "./photos.js";
import { findOwnedBuilding, VISION_MODEL } from "./buildings.js";
import { haversineMeters, LOCATION_MISMATCH_THRESHOLD_M } from "./group-photos.js";
import { cleanDesignation, DESIGNATION_PRESETS, STAFF_KIND_CLEANER } from "./roles.js";

const TZ = "America/Toronto";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_TASKS = 200;
const MAX_FILES = 20;
const MAX_PHOTOS_PER_KIND = 10;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ----- time helpers -----------------------------------------------------
export function torontoNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", hour12: false,
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    weekday: parts.weekday,
  };
}

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 24 * 60 ? mins : null;
}

// Accepts "6:00", "06:00", "6:00 AM", "6pm", "18:30" -> "HH:MM" (24h) or null.
export function normTime(value) {
  if (value == null) return null;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(value));
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function normDays(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const wanted = new Set(
    list
      .map((d) => String(d).trim().slice(0, 3).toLowerCase())
      .map((d) => DAY_NAMES.find((n) => n.toLowerCase() === d))
      .filter(Boolean),
  );
  return DAY_NAMES.filter((d) => wanted.has(d)).join(",");
}

const clampCount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_PHOTOS_PER_KIND) : null;
};

// What a task actually uses once the schedule's defaults fill in the blanks.
function effectiveSettings(task, schedule) {
  return {
    enforce: (task.enforce_times ?? schedule.enforce_times) === 1,
    general: task.general_photos ?? schedule.default_general_photos,
    detail: task.detail_photos ?? schedule.default_detail_photos,
  };
}

// 'any' = times aren't enforced; otherwise whether right now is before,
// inside, or after the task's window.
function windowState(task, enforce, nowMinutes) {
  if (!enforce) return "any";
  const start = toMinutes(task.start_time);
  const end = toMinutes(task.end_time);
  if (start != null && nowMinutes < start) return "before";
  if (end != null && nowMinutes > end) return "after";
  return "open";
}

const formatClock = (hhmm) => {
  const mins = toMinutes(hhmm);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// ----- shared guards ------------------------------------------------------
const isManager = (session) => session.role === "regional_manager" || session.role === "admin";
const isFieldStaff = (session) => session.role === "cleaner" || session.role === "superintendent";

function denyManagerOnly(session, headers) {
  return isManager(session) ? null : jsonError("Area Manager or Administrator access required.", 403, headers);
}

// ----- AI: schedule document -> proposed tasks ------------------------------
const SCHEDULE_PROMPT = `These attachments are pages of a work schedule for a building's cleaning or maintenance staff. It might be a weekly grid with a column per day, a daily checklist, a shift sheet, a table of tasks, or typed text. Extract every distinct RECURRING TASK and when it gets done. Combine every attachment into ONE list and don't repeat a task that appears more than once.

For each task give:
- title: a short imperative phrase, like "Mop main lobby floor" or "Empty garbage bins, floors 1-3"
- details: any extra instructions or notes for that task, or null if there are none
- location: the area it applies to (e.g. "Lobby", "Parking garage", "Floors 2-4"), or null
- days: the weekdays it's done, as an array using Mon, Tue, Wed, Thu, Fri, Sat, Sun. "Daily" means all seven. "Weekdays" means Mon-Fri. "Weekends" means Sat and Sun. On a grid with a column per day, include each day that has an entry (a check mark, a time, or text).
- start_time and end_time: in 24-hour HH:MM when the sheet gives a time or a range (e.g. "6am-8am" -> "06:00" and "08:00"; "by 2:00 PM" -> end_time "14:00" only; a single time like "7:30 AM" -> start_time only), otherwise null.

If the same task is listed at two different times in a day, return it as two tasks. Ignore page headers, company names, signatures, page numbers and legends. Don't invent tasks. Also give a short schedule_name (e.g. "Weekly cleaning schedule"). If nothing is readable, return an empty tasks array.`;

export async function handleScheduleAnalyze(request, session, env, corsHeaders) {
  const deny = denyManagerOnly(session, corsHeaders);
  if (deny) return deny;
  if (!env.GOOGLE_AI_KEY) return jsonError("AI schedule reading isn't configured on this deployment yet.", 503, corsHeaders);

  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const images = Array.isArray(body.images) ? body.images : [];
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 60_000) : "";
  if (!images.length && !text) return jsonError("Add a photo, a PDF, or paste the schedule text.", 400, corsHeaders);
  if (images.length > MAX_FILES) return jsonError(`Up to ${MAX_FILES} pages at a time.`, 400, corsHeaders);
  for (const img of images) {
    if (!img.data || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(img.mediaType)) {
      return jsonError("Unsupported file type — use JPEG, PNG, WEBP, or PDF.", 400, corsHeaders);
    }
  }
  const building = await findOwnedBuilding(env, session, buildingId, "id, name");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${env.GOOGLE_AI_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                ...images.map((img) => ({ inline_data: { mime_type: img.mediaType, data: img.data } })),
                ...(text ? [{ text: `Schedule text:\n${text}` }] : []),
                { text: SCHEDULE_PROMPT },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                schedule_name: { type: "STRING" },
                tasks: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      title: { type: "STRING" },
                      details: { type: "STRING", nullable: true },
                      location: { type: "STRING", nullable: true },
                      days: { type: "ARRAY", items: { type: "STRING", enum: DAY_NAMES } },
                      start_time: { type: "STRING", nullable: true },
                      end_time: { type: "STRING", nullable: true },
                    },
                    required: ["title", "days"],
                  },
                },
              },
              required: ["tasks"],
            },
          },
        }),
      },
    );
  } catch (error) {
    console.error("Gemini schedule request failed", error);
    return jsonError("Couldn't reach the AI reading service. Try again.", 502, corsHeaders);
  }
  if (!response.ok) {
    console.error("Gemini schedule error", response.status, await response.text().catch(() => ""));
    return jsonError("The AI reading service is unavailable right now.", 502, corsHeaders);
  }

  let parsed;
  try {
    const data = await response.json();
    parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
  } catch {
    return jsonError("Couldn't understand the AI's response. Try again.", 502, corsHeaders);
  }

  const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
    .map((t) => ({
      title: String(t.title || "").trim().slice(0, 120),
      details: String(t.details || "").trim().slice(0, 500) || null,
      location: String(t.location || "").trim().slice(0, 120) || null,
      // Nothing recognizable -> weekdays, which the manager sees and can fix in the review step.
      days: (normDays(t.days) || "Mon,Tue,Wed,Thu,Fri").split(","),
      startTime: normTime(t.start_time),
      endTime: normTime(t.end_time),
    }))
    .filter((t) => t.title)
    .slice(0, MAX_TASKS);

  // Keep the original pages with the building's photos, same as checklist setup.
  await Promise.all(
    images.map((img) =>
      storePhoto(env, { buildingId: building.id, imageBase64: img.data, mediaType: img.mediaType, context: "schedule-source", uploadedBy: session.id }).catch(
        (error) => console.error("Schedule source store failed", error),
      ),
    ),
  );

  return jsonOk({ name: String(parsed.schedule_name || "").trim().slice(0, 80) || "Schedule", tasks }, corsHeaders);
}

// ----- manager: create / list / update ----------------------------------------
function normalizeTasks(rawTasks, scheduleDefaults) {
  if (!Array.isArray(rawTasks) || !rawTasks.length) return { error: "Add at least one task." };
  if (rawTasks.length > MAX_TASKS) return { error: `Up to ${MAX_TASKS} tasks per schedule.` };
  const tasks = [];
  for (const raw of rawTasks) {
    const title = String(raw.title || "").trim().slice(0, 120);
    if (!title) return { error: "Every task needs a name." };
    const days = normDays(raw.days);
    if (!days) return { error: `“${title}” needs at least one day.` };
    const enforce = raw.enforceTimes === true ? 1 : raw.enforceTimes === false ? 0 : null;
    const task = {
      id: Number.parseInt(raw.id, 10) || null,
      title,
      details: String(raw.details || "").trim().slice(0, 500) || null,
      location: String(raw.location || "").trim().slice(0, 120) || null,
      days,
      start_time: normTime(raw.startTime ?? raw.start_time),
      end_time: normTime(raw.endTime ?? raw.end_time),
      enforce_times: enforce,
      general_photos: clampCount(raw.generalPhotos),
      detail_photos: clampCount(raw.detailPhotos),
    };
    const effectiveEnforce = (enforce ?? scheduleDefaults.enforce_times) === 1;
    if (effectiveEnforce && !task.start_time && !task.end_time) {
      return { error: `“${title}” is set to enforce times but has no start or end time.` };
    }
    if (task.start_time && task.end_time && toMinutes(task.start_time) > toMinutes(task.end_time)) {
      return { error: `“${title}” ends before it starts.` };
    }
    tasks.push(task);
  }
  return { tasks };
}

function normalizeDefaults(body) {
  const d = body.defaults || {};
  return {
    default_general_photos: clampCount(d.generalPhotos) ?? 1,
    default_detail_photos: clampCount(d.detailPhotos) ?? 3,
    enforce_times: d.enforceTimes === true ? 1 : 0,
  };
}

async function validateAssignees(env, buildingId, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map((v) => Number.parseInt(v, 10)).filter(Boolean))];
  if (!wanted.length) return [];
  const rows = (
    await env.DB.prepare(
      `SELECT id FROM users WHERE id IN (${wanted.map(() => "?").join(",")}) AND building_id = ? AND role = 'superintendent' AND is_active = 1`,
    )
      .bind(...wanted, buildingId)
      .all()
  ).results;
  return rows.map((r) => r.id);
}

const TASK_INSERT_SQL = `INSERT INTO schedule_tasks (schedule_id, title, details, location, days, start_time, end_time, enforce_times, general_photos, detail_photos, sort_order)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export async function handleScheduleCreate(request, session, env, corsHeaders) {
  const deny = denyManagerOnly(session, corsHeaders);
  if (deny) return deny;
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const building = await findOwnedBuilding(env, session, buildingId, "id");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) return jsonError("Give the schedule a name.", 400, corsHeaders);
  const defaults = normalizeDefaults(body);
  const { tasks, error } = normalizeTasks(body.tasks, defaults);
  if (error) return jsonError(error, 400, corsHeaders);
  const assignees = await validateAssignees(env, building.id, body.assigneeIds);

  const inserted = await env.DB.prepare(
    `INSERT INTO schedules (building_id, name, source_note, default_general_photos, default_detail_photos, enforce_times, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(building.id, name, String(body.sourceNote || "").slice(0, 200) || null, defaults.default_general_photos, defaults.default_detail_photos, defaults.enforce_times, session.id)
    .run();
  const scheduleId = inserted.meta.last_row_id;

  await env.DB.batch([
    ...tasks.map((t, i) =>
      env.DB.prepare(TASK_INSERT_SQL).bind(scheduleId, t.title, t.details, t.location, t.days, t.start_time, t.end_time, t.enforce_times, t.general_photos, t.detail_photos, i),
    ),
    ...assignees.map((userId) => env.DB.prepare("INSERT INTO schedule_assignees (schedule_id, user_id) VALUES (?, ?)").bind(scheduleId, userId)),
  ]);
  return jsonOk({ ok: true, scheduleId }, corsHeaders);
}

export async function handleScheduleList(request, session, env, corsHeaders) {
  const deny = denyManagerOnly(session, corsHeaders);
  if (deny) return deny;
  const url = new URL(request.url);
  const buildingId = Number.parseInt(url.searchParams.get("buildingId"), 10);
  const building = await findOwnedBuilding(env, session, buildingId, "id");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);
  const includeArchived = url.searchParams.get("archived") === "1";

  const schedules = (
    await env.DB.prepare(
      `SELECT id, building_id, name, source_note, default_general_photos, default_detail_photos, enforce_times, status, created_at
       FROM schedules WHERE building_id = ? ${includeArchived ? "" : "AND status = 'active'"} ORDER BY id DESC`,
    )
      .bind(building.id)
      .all()
  ).results;
  if (!schedules.length) return jsonOk({ schedules: [] }, corsHeaders);

  const ids = schedules.map((s) => s.id);
  const ph = ids.map(() => "?").join(",");
  const [tasks, assignees] = await Promise.all([
    env.DB.prepare(
      `SELECT id, schedule_id, title, details, location, days, start_time, end_time, enforce_times, general_photos, detail_photos, sort_order
       FROM schedule_tasks WHERE schedule_id IN (${ph}) AND active = 1 ORDER BY sort_order, id`,
    ).bind(...ids).all(),
    env.DB.prepare(
      `SELECT sa.schedule_id, u.id, u.full_name, u.staff_kind, u.designation
       FROM schedule_assignees sa JOIN users u ON u.id = sa.user_id WHERE sa.schedule_id IN (${ph})`,
    ).bind(...ids).all(),
  ]);

  return jsonOk(
    {
      schedules: schedules.map((s) => ({
        ...s,
        enforce_times: s.enforce_times === 1,
        tasks: tasks.results.filter((t) => t.schedule_id === s.id).map((t) => ({ ...t, enforce_times: t.enforce_times === null ? null : t.enforce_times === 1 })),
        assignees: assignees.results
          .filter((a) => a.schedule_id === s.id)
          .map((a) => ({ id: a.id, fullName: a.full_name, kind: a.staff_kind === STAFF_KIND_CLEANER ? "cleaner" : "superintendent", designation: a.designation })),
      })),
    },
    corsHeaders,
  );
}

// One endpoint saves everything the editor can change: name, defaults,
// who it's for, archive/restore, and the task list (matched by id; new
// ones inserted; any existing task left out is soft-deleted).
export async function handleScheduleUpdate(request, session, env, corsHeaders) {
  const deny = denyManagerOnly(session, corsHeaders);
  if (deny) return deny;
  const body = await request.json().catch(() => ({}));
  const scheduleId = Number.parseInt(body.scheduleId, 10);
  const schedule = await env.DB.prepare("SELECT id, building_id, name, default_general_photos, default_detail_photos, enforce_times FROM schedules WHERE id = ?")
    .bind(scheduleId)
    .first();
  if (!schedule || !(await findOwnedBuilding(env, session, schedule.building_id, "id"))) {
    return jsonError("Schedule not found.", 404, corsHeaders);
  }

  const statements = [];
  const defaults = body.defaults
    ? normalizeDefaults(body)
    : { default_general_photos: schedule.default_general_photos, default_detail_photos: schedule.default_detail_photos, enforce_times: schedule.enforce_times };
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) : schedule.name;
  if (!name) return jsonError("Give the schedule a name.", 400, corsHeaders);
  const status = body.status === "archived" ? "archived" : body.status === "active" ? "active" : null;

  if (body.tasks !== undefined) {
    const { tasks, error } = normalizeTasks(body.tasks, defaults);
    if (error) return jsonError(error, 400, corsHeaders);
    const existing = (await env.DB.prepare("SELECT id FROM schedule_tasks WHERE schedule_id = ? AND active = 1").bind(scheduleId).all()).results.map((r) => r.id);
    const keep = new Set();
    tasks.forEach((t, i) => {
      if (t.id && existing.includes(t.id)) {
        keep.add(t.id);
        statements.push(
          env.DB.prepare(
            `UPDATE schedule_tasks SET title = ?, details = ?, location = ?, days = ?, start_time = ?, end_time = ?, enforce_times = ?, general_photos = ?, detail_photos = ?, sort_order = ? WHERE id = ? AND schedule_id = ?`,
          ).bind(t.title, t.details, t.location, t.days, t.start_time, t.end_time, t.enforce_times, t.general_photos, t.detail_photos, i, t.id, scheduleId),
        );
      } else {
        statements.push(env.DB.prepare(TASK_INSERT_SQL).bind(scheduleId, t.title, t.details, t.location, t.days, t.start_time, t.end_time, t.enforce_times, t.general_photos, t.detail_photos, i));
      }
    });
    for (const id of existing) if (!keep.has(id)) statements.push(env.DB.prepare("UPDATE schedule_tasks SET active = 0 WHERE id = ?").bind(id));
  }

  if (body.assigneeIds !== undefined) {
    const assignees = await validateAssignees(env, schedule.building_id, body.assigneeIds);
    statements.push(env.DB.prepare("DELETE FROM schedule_assignees WHERE schedule_id = ?").bind(scheduleId));
    for (const userId of assignees) statements.push(env.DB.prepare("INSERT INTO schedule_assignees (schedule_id, user_id) VALUES (?, ?)").bind(scheduleId, userId));
  }

  statements.push(
    env.DB.prepare(
      `UPDATE schedules SET name = ?, default_general_photos = ?, default_detail_photos = ?, enforce_times = ?, status = COALESCE(?, status), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(name, defaults.default_general_photos, defaults.default_detail_photos, defaults.enforce_times, status, scheduleId),
  );
  await env.DB.batch(statements);
  return jsonOk({ ok: true }, corsHeaders);
}

// ----- manager: proof of work for a day --------------------------------------
export async function handleScheduleCompletions(request, session, env, corsHeaders) {
  const deny = denyManagerOnly(session, corsHeaders);
  if (deny) return deny;
  const url = new URL(request.url);
  const buildingId = Number.parseInt(url.searchParams.get("buildingId"), 10);
  const building = await findOwnedBuilding(env, session, buildingId, "id");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);
  const now = torontoNow();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date") : now.date;
  const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

  const [tasks, completions] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, t.title, t.details, t.location, t.days, t.start_time, t.end_time, t.enforce_times, t.general_photos, t.detail_photos, t.active,
         s.name AS schedule_name, s.enforce_times AS s_enforce, s.default_general_photos, s.default_detail_photos
       FROM schedule_tasks t JOIN schedules s ON s.id = t.schedule_id
       WHERE s.building_id = ? AND s.status = 'active' AND t.active = 1 ORDER BY t.sort_order, t.id`,
    ).bind(building.id).all(),
    env.DB.prepare(
      `SELECT c.id, c.task_id, c.status, c.started_at, c.completed_at, c.late, c.required_general, c.required_detail, u.full_name, u.staff_kind, u.designation
       FROM task_completions c JOIN users u ON u.id = c.user_id WHERE c.building_id = ? AND c.date = ?`,
    ).bind(building.id, date).all(),
  ]);
  const completionByTask = new Map(completions.results.map((c) => [c.task_id, c]));

  const photoRows = completions.results.length
    ? (
        await env.DB.prepare(
          `SELECT id, completion_id, kind, photo_key, captured_at, distance_from_building_m FROM task_photos
           WHERE completion_id IN (${completions.results.map(() => "?").join(",")}) ORDER BY id`,
        ).bind(...completions.results.map((c) => c.id)).all()
      ).results
    : [];

  // A task shows up for the day if it's scheduled that weekday, or if it was worked on that day anyway.
  const rows = tasks.results
    .filter((t) => t.days.split(",").includes(weekday) || completionByTask.has(t.id))
    .map((t) => {
      const schedule = { enforce_times: t.s_enforce, default_general_photos: t.default_general_photos, default_detail_photos: t.default_detail_photos };
      const eff = effectiveSettings(t, schedule);
      const c = completionByTask.get(t.id);
      const endMinutes = toMinutes(t.end_time);
      let status = "todo";
      if (c?.status === "completed") status = "done";
      else if (c) status = "in_progress";
      else if (date < now.date) status = "missed";
      else if (date > now.date) status = "upcoming";
      else if (endMinutes != null && now.minutes > endMinutes) status = "missed";
      return {
        taskId: t.id,
        title: t.title,
        details: t.details,
        location: t.location,
        scheduleName: t.schedule_name,
        startTime: t.start_time,
        endTime: t.end_time,
        enforce: eff.enforce,
        requiredGeneral: c?.required_general ?? eff.general,
        requiredDetail: c?.required_detail ?? eff.detail,
        status,
        completedBy: c ? { name: c.full_name, designation: c.designation, kind: c.staff_kind === STAFF_KIND_CLEANER ? "cleaner" : "superintendent" } : null,
        completedAt: c?.completed_at || null,
        startedAt: c?.started_at || null,
        late: c?.late === 1,
        photos: c
          ? photoRows
              .filter((p) => p.completion_id === c.id)
              .map((p) => ({ id: p.id, kind: p.kind, key: p.photo_key, capturedAt: p.captured_at, distanceM: p.distance_from_building_m, offSite: p.distance_from_building_m != null && p.distance_from_building_m > LOCATION_MISMATCH_THRESHOLD_M }))
          : [],
      };
    });

  return jsonOk(
    {
      date,
      weekday,
      isToday: date === now.date,
      tasks: rows,
      summary: { total: rows.length, done: rows.filter((r) => r.status === "done").length, missed: rows.filter((r) => r.status === "missed").length },
    },
    corsHeaders,
  );
}

// ----- manager: staff + designations --------------------------------------------
export async function handleStaffList(request, session, env, corsHeaders) {
  const deny = denyManagerOnly(session, corsHeaders);
  if (deny) return deny;
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  const building = await findOwnedBuilding(env, session, buildingId, "id");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);
  const rows = (
    await env.DB.prepare(
      `SELECT id, full_name, job_title, staff_kind, designation, status FROM users
       WHERE building_id = ? AND role = 'superintendent' AND is_active = 1 AND removed_at IS NULL ORDER BY staff_kind IS NOT NULL, full_name`,
    ).bind(building.id).all()
  ).results;
  return jsonOk(
    {
      staff: rows.map((r) => ({ id: r.id, fullName: r.full_name, kind: r.staff_kind === STAFF_KIND_CLEANER ? "cleaner" : "superintendent", designation: r.designation })),
      presets: DESIGNATION_PRESETS,
    },
    corsHeaders,
  );
}

export async function handleStaffUpdate(request, session, env, corsHeaders) {
  const deny = denyManagerOnly(session, corsHeaders);
  if (deny) return deny;
  const body = await request.json().catch(() => ({}));
  const userId = Number.parseInt(body.userId, 10);
  const target = await env.DB.prepare("SELECT id, building_id, staff_kind FROM users WHERE id = ? AND role = 'superintendent' AND is_active = 1").bind(userId).first();
  if (!target?.building_id || !(await findOwnedBuilding(env, session, target.building_id, "id"))) {
    return jsonError("Person not found.", 404, corsHeaders);
  }
  // Role: a Cleaner or a Superintendent. The designation (light duty,
  // assistant superintendent, ...) is a free-text variant on top of either.
  const kind = body.kind === "cleaner" ? STAFF_KIND_CLEANER : body.kind === "superintendent" ? null : target.staff_kind;
  const designation = body.designation !== undefined ? cleanDesignation(body.designation) : undefined;
  await env.DB.prepare(
    `UPDATE users SET staff_kind = ?, job_title = ?, designation = ${designation === undefined ? "designation" : "?"} WHERE id = ?`,
  )
    .bind(kind, kind === STAFF_KIND_CLEANER ? "Cleaner" : "Superintendent", ...(designation === undefined ? [] : [designation]), userId)
    .run();
  return jsonOk({ ok: true }, corsHeaders);
}

// ----- field staff: today's checklist + proof photos ------------------------------
async function loadAssignedTasks(env, session, now) {
  if (!session.building_id) return [];
  return (
    await env.DB.prepare(
      `SELECT t.id, t.title, t.details, t.location, t.days, t.start_time, t.end_time, t.enforce_times, t.general_photos, t.detail_photos, t.sort_order,
         s.id AS schedule_id, s.name AS schedule_name, s.enforce_times AS s_enforce, s.default_general_photos, s.default_detail_photos
       FROM schedule_tasks t
       JOIN schedules s ON s.id = t.schedule_id AND s.status = 'active' AND s.building_id = ?
       JOIN schedule_assignees a ON a.schedule_id = s.id AND a.user_id = ?
       WHERE t.active = 1 ORDER BY t.sort_order, t.id`,
    )
      .bind(session.building_id, session.id)
      .all()
  ).results.filter((t) => t.days.split(",").includes(now.weekday));
}

const scheduleFields = (t) => ({ enforce_times: t.s_enforce, default_general_photos: t.default_general_photos, default_detail_photos: t.default_detail_photos });

export async function handleMyTasksToday(session, env, corsHeaders) {
  if (!isFieldStaff(session)) return jsonError("Not available for this role.", 403, corsHeaders);
  const now = torontoNow();
  const tasks = await loadAssignedTasks(env, session, now);
  if (!tasks.length) return jsonOk({ date: now.date, buildingId: session.building_id, tasks: [], summary: { total: 0, done: 0 } }, corsHeaders);

  const completions = (
    await env.DB.prepare(
      `SELECT c.id, c.task_id, c.status, c.completed_at, c.late, c.required_general, c.required_detail, c.user_id, u.full_name
       FROM task_completions c JOIN users u ON u.id = c.user_id
       WHERE c.date = ? AND c.task_id IN (${tasks.map(() => "?").join(",")})`,
    ).bind(now.date, ...tasks.map((t) => t.id)).all()
  ).results;
  const photos = completions.length
    ? (
        await env.DB.prepare(`SELECT id, completion_id, kind, photo_key FROM task_photos WHERE completion_id IN (${completions.map(() => "?").join(",")}) ORDER BY id`)
          .bind(...completions.map((c) => c.id))
          .all()
      ).results
    : [];

  const view = tasks.map((t) => {
    const eff = effectiveSettings(t, scheduleFields(t));
    const c = completions.find((x) => x.task_id === t.id);
    const mine = c ? photos.filter((p) => p.completion_id === c.id) : [];
    const state = windowState(t, eff.enforce, now.minutes);
    let status = c?.status === "completed" ? "done" : c ? "in_progress" : "todo";
    if (status !== "done" && state === "after") status = "missed";
    return {
      id: t.id,
      title: t.title,
      details: t.details,
      location: t.location,
      scheduleName: t.schedule_name,
      startTime: t.start_time,
      endTime: t.end_time,
      enforce: eff.enforce,
      windowState: state,
      requiredGeneral: c?.required_general ?? eff.general,
      requiredDetail: c?.required_detail ?? eff.detail,
      status,
      late: c?.late === 1,
      completedAt: c?.completed_at || null,
      completedBy: c?.status === "completed" ? c.full_name : null,
      photos: mine.map((p) => ({ id: p.id, kind: p.kind, key: p.photo_key })),
    };
  });
  return jsonOk({ date: now.date, buildingId: session.building_id, tasks: view, summary: { total: view.length, done: view.filter((v) => v.status === "done").length } }, corsHeaders);
}

// Everything that has to be true for this person to work on this task right now.
async function loadWorkableTask(env, session, taskId, now) {
  const task = (await loadAssignedTasks(env, session, now)).find((t) => t.id === taskId);
  if (!task) return { error: "That task isn't on your checklist today.", status: 404 };
  const eff = effectiveSettings(task, scheduleFields(task));
  const state = windowState(task, eff.enforce, now.minutes);
  if (state === "before") return { error: `This task opens at ${formatClock(task.start_time)}.`, status: 409 };
  if (state === "after") return { error: `The time window for this task closed at ${formatClock(task.end_time)}.`, status: 409 };
  return { task, eff };
}

async function ensureCompletion(env, session, task, eff, now) {
  await env.DB.prepare(
    `INSERT INTO task_completions (task_id, building_id, date, user_id, required_general, required_detail)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (task_id, date) DO NOTHING`,
  )
    .bind(task.id, session.building_id, now.date, session.id, eff.general, eff.detail)
    .run();
  return env.DB.prepare("SELECT id, status, required_general, required_detail FROM task_completions WHERE task_id = ? AND date = ?").bind(task.id, now.date).first();
}

async function photoCounts(env, completionId) {
  const rows = (await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM task_photos WHERE completion_id = ? GROUP BY kind").bind(completionId).all()).results;
  return { general: rows.find((r) => r.kind === "general")?.n || 0, detail: rows.find((r) => r.kind === "detail")?.n || 0 };
}

export async function handleTaskPhotoUpload(request, session, env, corsHeaders) {
  if (!isFieldStaff(session)) return jsonError("Not available for this role.", 403, corsHeaders);
  const form = await request.formData().catch(() => null);
  const taskId = Number.parseInt(form?.get("taskId"), 10);
  const kind = String(form?.get("kind") || "");
  const image = form?.get("photo");
  const capturedAt = String(form?.get("capturedAt") || new Date().toISOString());
  const lat = form?.has("latitude") ? Number(form.get("latitude")) : NaN;
  const lon = form?.has("longitude") ? Number(form.get("longitude")) : NaN;

  if (!taskId || !["general", "detail"].includes(kind) || !image || typeof image.arrayBuffer !== "function") {
    return jsonError("A photo and a task are required.", 400, corsHeaders);
  }
  if (!ALLOWED_PHOTO_TYPES.has(image.type)) return jsonError("Unsupported image type — use JPEG, PNG, or WEBP.", 400, corsHeaders);
  if (image.size > 20_000_000) return jsonError("That photo is too large. Try again.", 400, corsHeaders);

  const now = torontoNow();
  const loaded = await loadWorkableTask(env, session, taskId, now);
  if (loaded.error) return jsonError(loaded.error, loaded.status, corsHeaders);
  const { task, eff } = loaded;

  const completion = await ensureCompletion(env, session, task, eff, now);
  if (completion.status === "completed") return jsonError("This task is already done.", 409, corsHeaders);
  const counts = await photoCounts(env, completion.id);
  const need = { general: completion.required_general, detail: completion.required_detail };
  if (counts[kind] >= need[kind]) {
    return jsonError(kind === "general" ? "The general photo is already in." : "All the detail photos are already in.", 409, corsHeaders);
  }
  if (kind === "detail" && counts.general < need.general) return jsonError("Take the general photo first.", 409, corsHeaders);

  const photoKey = await storePhoto(env, {
    buildingId: session.building_id,
    imageBlob: image,
    mediaType: image.type,
    context: `task-${task.id}-${kind}`,
    uploadedBy: session.id,
  });
  if (!photoKey) return jsonError("Photo storage isn't configured on this deployment.", 503, corsHeaders);

  let distance = null;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const b = await env.DB.prepare("SELECT latitude, longitude FROM buildings WHERE id = ?").bind(session.building_id).first();
    if (b?.latitude != null && b?.longitude != null) distance = Math.round(haversineMeters(lat, lon, b.latitude, b.longitude));
  }
  const inserted = await env.DB.prepare(
    `INSERT INTO task_photos (completion_id, kind, photo_key, captured_at, latitude, longitude, distance_from_building_m) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(completion.id, kind, photoKey, capturedAt, Number.isFinite(lat) ? lat : null, Number.isFinite(lon) ? lon : null, distance)
    .run();

  const after = await photoCounts(env, completion.id);
  return jsonOk(
    {
      ok: true,
      photo: { id: inserted.meta.last_row_id, kind, key: photoKey },
      progress: { general: after.general, detail: after.detail, requiredGeneral: need.general, requiredDetail: need.detail, ready: after.general >= need.general && after.detail >= need.detail },
      locationMismatch: distance != null && distance > LOCATION_MISMATCH_THRESHOLD_M,
    },
    corsHeaders,
  );
}

export async function handleTaskPhotoRemove(request, session, env, corsHeaders) {
  if (!isFieldStaff(session)) return jsonError("Not available for this role.", 403, corsHeaders);
  const body = await request.json().catch(() => ({}));
  const photoId = Number.parseInt(body.photoId, 10);
  const row = await env.DB.prepare(
    `SELECT p.id, c.status, c.building_id FROM task_photos p JOIN task_completions c ON c.id = p.completion_id WHERE p.id = ?`,
  ).bind(photoId).first();
  if (!row || row.building_id !== session.building_id) return jsonError("Photo not found.", 404, corsHeaders);
  if (row.status === "completed") return jsonError("A finished task's photos can't be changed.", 409, corsHeaders);
  // Only the database row goes: the stored file is kept, same as every other photo in the app.
  await env.DB.prepare("DELETE FROM task_photos WHERE id = ?").bind(photoId).run();
  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleTaskComplete(request, session, env, corsHeaders) {
  if (!isFieldStaff(session)) return jsonError("Not available for this role.", 403, corsHeaders);
  const body = await request.json().catch(() => ({}));
  const taskId = Number.parseInt(body.taskId, 10);
  const now = torontoNow();
  const loaded = await loadWorkableTask(env, session, taskId, now);
  if (loaded.error) return jsonError(loaded.error, loaded.status, corsHeaders);
  const { task, eff } = loaded;

  const completion = await ensureCompletion(env, session, task, eff, now);
  if (completion.status === "completed") return jsonError("This task is already done.", 409, corsHeaders);
  const counts = await photoCounts(env, completion.id);
  if (counts.general < completion.required_general || counts.detail < completion.required_detail) {
    return jsonError(
      `Photos still needed: ${Math.max(completion.required_general - counts.general, 0)} general, ${Math.max(completion.required_detail - counts.detail, 0)} detail.`,
      409,
      corsHeaders,
    );
  }
  // Not enforced: the window is only guidance, but finishing after it ends is recorded as late.
  const endMinutes = toMinutes(task.end_time);
  const late = !eff.enforce && endMinutes != null && now.minutes > endMinutes ? 1 : 0;
  await env.DB.prepare("UPDATE task_completions SET status = 'completed', completed_at = CURRENT_TIMESTAMP, late = ?, user_id = ? WHERE id = ?")
    .bind(late, session.id, completion.id)
    .run();
  return jsonOk({ ok: true, late: late === 1 }, corsHeaders);
}

// ----- responses ----------------------------------------------------------------
function jsonOk(data, headers) {
  return new Response(JSON.stringify(data), { status: 200, headers: withJsonHeaders(headers) });
}
function jsonError(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), { status, headers: withJsonHeaders(headers) });
}
function withJsonHeaders(headers) {
  const out = new Headers(headers);
  out.set("Content-Type", "application/json; charset=utf-8");
  out.set("Cache-Control", "no-store");
  return out;
}
