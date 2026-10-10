// The weekly report: one workbook per Mon-Sun week -- a Summary sheet
// across every building, then one sheet per building laying every
// reading out as a machine-by-day grid (red where a reading was outside
// normal), the flagged-readings list, the week's notes, and a blank area
// for the manager's own comments. Built on demand from the live data, so
// any past week is always available and the current week is always
// current -- nothing is stored or has to be backfilled.

import { Workbook, S } from "./xlsx-writer.js";
import { weekDates, todayIso, weekdayName } from "./dashboard-data.js";
import { loadBaselines, evaluateDeviation, MIN_BASELINE_DAYS, inferTolerance, trendMonitored } from "./deviation.js";
import { ghlUpsertContact, ghlSendEmail } from "./ghl.js";
import { getNativeClientId } from "./tenant-db.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_APP_URL = "https://power-log-command.pages.dev";

// ----- small formatting helpers ---------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function mondayOf(isoDate) {
  return weekDates(isoDate)[0];
}

function dayLabel(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${weekdayName(iso)} ${m}/${d}`;
}

function longDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function weekTitle(dates) {
  return `${longDate(dates[0])} – ${longDate(dates[6])}, ${dates[6].slice(0, 4)}`;
}

export function reportFilename(weekStart) {
  return weekStart === "all" ? "Inspect-N-Snap-All-Days.xlsx" : `Inspect-N-Snap-Weekly-${weekStart}.xlsx`;
}

const readingLabel = (tag) => [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ") || tag.system_name;
const asCell = (value) => (/^-?\d+(\.\d+)?$/.test(String(value).trim()) ? Number(value) : String(value));
const withUnit = (value, unit) => (!unit ? `${value}` : unit === "°" ? `${value}°` : `${value} ${unit}`);

// ----- data -----------------------------------------------------------
async function gatherBuilding(env, building, dates, today) {
  const scheduledNames = new Set((building.inspection_days || "").split(",").map((d) => d.trim()));
  const [tagsRes, subsRes, ordersRes] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, t.system_name, t.tag_no, t.reading_type, t.unit, t.answer_kind AS value_type, t.sort_order, t.monitor_trend,
         t.equipment_group_id, g.name AS group_name, p.min_value, p.max_value, p.expected_value
       FROM inspection_tags t
       LEFT JOIN equipment_groups g ON g.id = t.equipment_group_id
       LEFT JOIN inspection_parameters p ON p.tag_id = t.id
       WHERE t.building_id = ? ORDER BY t.sort_order`,
    )
      .bind(building.id)
      .all(),
    env.DB.prepare(
      `SELECT s.id, s.inspection_date, s.status, s.locked_partial_at, s.started_at, s.submitted_at, s.notes, u.full_name AS author
       FROM inspection_submissions s LEFT JOIN users u ON u.id = s.superintendent_id
       WHERE s.building_id = ? AND s.inspection_date >= ? AND s.inspection_date <= ?`,
    )
      .bind(building.id, dates[0], dates[dates.length - 1])
      .all(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM work_orders WHERE building_id = ? AND status = 'open'").bind(building.id).first(),
  ]);

  const tags = tagsRes.results.map((t) => ({
    ...t,
    parameter:
      t.min_value != null || t.max_value != null || t.expected_value != null
        ? { min: t.min_value, max: t.max_value, expected: t.expected_value }
        : null,
  }));
  const subs = subsRes.results;
  const subByDate = new Map(subs.map((s) => [s.inspection_date, s]));

  const readingsBySub = new Map();
  let groupNotes = [];
  const baselinesByDate = new Map();
  if (subs.length) {
    const ids = subs.map((s) => s.id);
    const placeholders = ids.map(() => "?").join(",");
    const [readingsRes, notesRes, ...baselines] = await Promise.all([
      env.DB.prepare(`SELECT submission_id, tag_id, value, flagged, deviation FROM inspection_readings WHERE submission_id IN (${placeholders})`)
        .bind(...ids)
        .all(),
      env.DB.prepare(
        `SELECT gn.submission_id, g.name AS group_name, gn.note FROM group_notes gn
         JOIN equipment_groups g ON g.id = gn.equipment_group_id WHERE gn.submission_id IN (${placeholders})`,
      )
        .bind(...ids)
        .all(),
      ...subs.map((s) => loadBaselines(env, building.id, s.inspection_date)),
    ]);
    subs.forEach((s, i) => baselinesByDate.set(s.inspection_date, baselines[i]));
    for (const row of readingsRes.results) {
      if (!readingsBySub.has(row.submission_id)) readingsBySub.set(row.submission_id, new Map());
      readingsBySub.get(row.submission_id).set(row.tag_id, row);
    }
    groupNotes = notesRes.results;
  }

  const tagById = new Map(tags.map((t) => [t.id, t]));
  const days = [];
  const flagged = [];
  const notes = [];

  for (const date of dates) {
    const scheduled = scheduledNames.has(weekdayName(date));
    const sub = subByDate.get(date);
    if (!scheduled && !sub) continue;

    let state;
    if (sub?.status === "submitted") state = "submitted";
    else if (sub?.locked_partial_at) state = "partial";
    else if (sub) state = date < today ? "partial_pending" : "in_progress";
    else if (date > today) state = "upcoming";
    else if (date === today) state = "due_today";
    else state = "missed";

    const readings = new Map();
    if (sub) {
      const rows = readingsBySub.get(sub.id) || new Map();
      const baselines = baselinesByDate.get(date) || {};
      for (const [tagId, row] of rows) {
        const tag = tagById.get(tagId);
        if (!tag || row.value == null || String(row.value).trim() === "") continue;
        let deviation = null;
        if (row.deviation) {
          try {
            deviation = JSON.parse(row.deviation);
          } catch {
            deviation = null;
          }
        }
        // Anything recorded at submit time wins (it carries the
        // superintendent's own answer); older days and partial days get
        // judged now against the baseline as it stood on that date.
        deviation = deviation || evaluateDeviation(tag, row.value, baselines[tagId]);
        readings.set(tagId, { value: String(row.value).trim(), deviation });
        if (deviation) {
          flagged.push({ date, tag, value: String(row.value).trim(), deviation });
        }
      }
      if (sub.notes && sub.notes.trim()) {
        notes.push({ date, where: "Daily inspection", text: sub.notes.trim(), author: sub.author });
      }
      for (const gn of groupNotes) {
        if (gn.submission_id === sub.id && gn.note && gn.note.trim()) {
          notes.push({ date, where: gn.group_name, text: gn.note.trim(), author: sub.author });
        }
      }
    }
    days.push({ date, label: dayLabel(date), scheduled, state, sub, readings });
  }

  const scheduledDays = days.filter((d) => d.scheduled);
  const counts = {
    scheduled: scheduledDays.length,
    submitted: days.filter((d) => d.state === "submitted").length,
    partial: days.filter((d) => d.state === "partial" || d.state === "partial_pending").length,
    missed: days.filter((d) => d.state === "missed").length,
    // Days that have actually come due -- today only counts once it has
    // something on it, so a Wednesday-morning download isn't dragged
    // down by an inspection nobody has had time to do yet.
    due: scheduledDays.filter((d) => d.date < today || ["submitted", "partial", "partial_pending", "in_progress"].includes(d.state)).length,
    flagged: flagged.length,
    ackAbnormal: flagged.filter((f) => f.deviation.ack === "abnormal").length,
  };

  // The same order command mode walks a superintendent through, so the
  // spreadsheet reads top to bottom the way the inspection is actually
  // done: original scan order, with a machine sitting wherever its
  // FIRST reading was scanned and ungrouped readings sitting individually
  // between machines (not lumped together at the top). Deliberately not
  // the manager's board arrangement. `tags` already comes back ordered by
  // sort_order, so the first tag seen for a machine is its earliest.
  const machineFirst = new Map();
  for (const tag of tags) {
    if (tag.equipment_group_id != null && !machineFirst.has(tag.equipment_group_id)) {
      machineFirst.set(tag.equipment_group_id, tag.sort_order);
    }
  }
  const stopPosition = (t) => (t.equipment_group_id == null ? t.sort_order : machineFirst.get(t.equipment_group_id));
  const walk = [...tags].sort((a, b) => stopPosition(a) - stopPosition(b) || a.sort_order - b.sort_order);
  const groups = [];
  walk.forEach((tag, i) => {
    tag.walkNumber = i + 1; // "reading 12 of 138" in command mode
    const key = tag.equipment_group_id ?? 0;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.tags.push(tag);
    else groups.push({ key, name: tag.group_name || "Other readings", first: tag.sort_order, tags: [tag] });
  });

  const lastBaselineDay = [...days].reverse().find((d) => baselinesByDate.has(d.date));
  const authors = [...new Set(subs.map((s) => s.author).filter(Boolean))];

  return {
    id: building.id,
    name: building.name,
    days,
    groups,
    flagged,
    notes,
    counts,
    openWorkOrders: ordersRes?.c || 0,
    authors,
    endBaselines: lastBaselineDay ? baselinesByDate.get(lastBaselineDay.date) : {},
  };
}

async function gatherRange(env, dates) {
  const today = todayIso();
  const buildingRows = (
    await env.DB.prepare(
      "SELECT id, name, address, inspection_days FROM buildings WHERE status = 'active' AND deleted_at IS NULL ORDER BY name",
    ).all()
  ).results;
  const buildings = [];
  for (const row of buildingRows) buildings.push(await gatherBuilding(env, row, dates, today));
  return { dates, today, buildings };
}

export const gatherWeek = (env, weekStartIso) => gatherRange(env, weekDates(weekStartIso));

// Every calendar day from the first recorded inspection through today.
async function allRecordedDates(env) {
  const first = await env.DB.prepare("SELECT MIN(inspection_date) AS d FROM inspection_submissions").first();
  const today = todayIso();
  const dates = [];
  let cursor = first?.d || today;
  while (cursor <= today && dates.length < 3700) {
    dates.push(cursor);
    const next = new Date(`${cursor}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
  }
  return dates;
}

// ----- workbook -------------------------------------------------------
const STATE_LABEL = {
  submitted: "Submitted",
  partial: "Partial (locked)",
  partial_pending: "Partial",
  in_progress: "In progress",
  due_today: "Not yet submitted",
  missed: "Missed",
  upcoming: "Upcoming",
};
const STATE_STYLE = {
  submitted: S.headSubmitted,
  partial: S.headPartial,
  partial_pending: S.headPartial,
  missed: S.headMissed,
};

function normalText(tag, baseline) {
  if (tag.parameter?.min != null && tag.parameter?.max != null) return withUnit(`${tag.parameter.min}–${tag.parameter.max}`, tag.unit);
  if (tag.parameter?.expected) return `Expected: ${tag.parameter.expected}`;
  if (tag.value_type && tag.value_type !== "numeric") return "";
  if (tag.monitor_trend === 0) return "Not monitored";
  // Meters, pump RPM/amps/Hz etc. have no fixed normal worth showing.
  if (!trendMonitored(tag)) return "";
  if (baseline) {
    const tol = inferTolerance(tag.unit, tag.reading_type);
    return `about ${Math.round(baseline.avg * 10) / 10}${tol != null ? ` (±${tol})` : ""}`;
  }
  return `Learning (needs ${MIN_BASELINE_DAYS} days)`;
}

const answerLabel = (ack) => (ack === "abnormal" ? "Called abnormal" : ack === "normal" ? "Called normal" : "No answer recorded");

function rowHeightFor(text, widthChars) {
  const lines = String(text)
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / widthChars)), 0);
  return Math.max(20, 15 * lines + 5);
}

function writeCommentsBlock(ws, row, lastCol) {
  ws.set(row, 0, "Manager comments", S.section);
  row += 1;
  for (let i = 0; i < 6; i += 1) {
    ws.merge(row, 0, row, lastCol);
    ws.fill(row, 0, lastCol, S.blank);
    ws.height(row, 26);
    row += 1;
  }
  row += 1;
  ws.set(row, 0, "Reviewed by: ________________________", S.default);
  ws.set(row, Math.min(3, lastCol), "Date: ______________", S.default);
  return row + 1;
}

function writeBuildingSheet(wb, bld, week, opts = {}) {
  const dayCount = bld.days.length;
  const lastCol = Math.max(2 + dayCount, 6);
  const cols = [38, 9, 22, ...Array.from({ length: Math.max(dayCount, 4) }, () => opts.dayWidth ?? 15)];
  const ws = wb.addSheet(bld.name, { cols, freeze: { rows: 5, cols: 3 } });

  ws.set(0, 0, `${bld.name} — ${opts.title || `Week of ${weekTitle(week.dates)}`}`, S.title);
  ws.merge(0, 0, 0, lastCol);
  ws.height(0, 28);
  ws.set(1, 0, opts.subtitle || "Red cells were outside normal for that reading. Columns show each scheduled inspection day and how it ended.", S.subtitle);
  ws.merge(1, 0, 1, lastCol);

  ws.set(3, 0, "Reading (in walk-through order)", S.header).set(3, 1, "Unit", S.header).set(3, 2, "Normal", S.header);
  ws.set(4, 0, "Day status", S.headNeutral).set(4, 1, "", S.headNeutral).set(4, 2, "", S.headNeutral);
  ws.height(3, 24);
  ws.height(4, 34);
  bld.days.forEach((day, i) => {
    ws.set(3, 3 + i, day.label, S.header);
    const who = day.sub?.author ? `\n${day.sub.author}` : "";
    ws.set(4, 3 + i, `${STATE_LABEL[day.state]}${who}`, STATE_STYLE[day.state] || S.headNeutral);
  });
  if (!dayCount) {
    ws.set(5, 0, "No inspections were scheduled this week.", S.note);
    ws.merge(5, 0, 5, lastCol);
  }

  let row = 5;
  for (const group of bld.groups) {
    ws.set(row, 0, group.name, S.machine);
    ws.merge(row, 0, row, lastCol);
    ws.fill(row, 0, lastCol, S.machine);
    row += 1;
    for (const tag of group.tags) {
      ws.set(row, 0, `${tag.walkNumber}. ${readingLabel(tag)}`, S.text);
      ws.set(row, 1, tag.unit || "", S.center);
      ws.set(row, 2, normalText(tag, bld.endBaselines[tag.id]), S.center);
      bld.days.forEach((day, i) => {
        const reading = day.readings.get(tag.id);
        if (!reading) ws.set(row, 3 + i, "—", S.muted);
        else ws.set(row, 3 + i, asCell(reading.value), reading.deviation ? S.flag : S.center);
      });
      row += 1;
    }
  }

  row += 1;
  ws.set(row, 0, `Readings outside normal (${bld.flagged.length})`, S.section);
  row += 1;
  if (!bld.flagged.length) {
    ws.set(row, 0, "Nothing was outside its normal this week.", S.note);
    ws.merge(row, 0, row, lastCol);
    row += 1;
  } else {
    const heads = ["Reading", "Day", "What happened", "Value", "Change", "Superintendent's answer"];
    heads.forEach((h, i) => ws.set(row, i, h, S.header));
    ws.merge(row, 5, row, lastCol);
    ws.fill(row, 5, lastCol, S.header);
    row += 1;
    for (const f of bld.flagged) {
      const group = bld.groups.find((g) => g.tags.some((t) => t.id === f.tag.id));
      ws.set(row, 0, `${group ? `${group.name}: ` : ""}${readingLabel(f.tag)}`, S.text);
      ws.set(row, 1, dayLabel(f.date), S.center);
      ws.set(row, 2, f.deviation.detail || "", S.text);
      ws.set(row, 3, withUnit(asCell(f.value), f.tag.unit), S.flag);
      ws.set(row, 4, f.deviation.change != null ? (f.deviation.change > 0 ? `+${f.deviation.change}` : `${f.deviation.change}`) : "", S.center);
      ws.set(row, 5, answerLabel(f.deviation.ack), S.text);
      ws.merge(row, 5, row, lastCol);
      ws.fill(row, 5, lastCol, S.text);
      ws.height(row, rowHeightFor(f.deviation.detail || "", 24));
      row += 1;
    }
  }

  row += 1;
  ws.set(row, 0, "Notes from the week", S.section);
  row += 1;
  if (!bld.notes.length) {
    ws.set(row, 0, "No notes were left this week.", S.note);
    ws.merge(row, 0, row, lastCol);
    row += 1;
  } else {
    ws.set(row, 0, "Where", S.header).set(row, 1, "Day", S.header).set(row, 2, "Note", S.header);
    ws.merge(row, 2, row, lastCol);
    ws.fill(row, 2, lastCol, S.header);
    row += 1;
    for (const n of bld.notes) {
      ws.set(row, 0, n.where, S.text);
      ws.set(row, 1, dayLabel(n.date), S.center);
      ws.set(row, 2, `${n.text}${n.author ? `  — ${n.author}` : ""}`, S.note);
      ws.merge(row, 2, row, lastCol);
      ws.fill(row, 2, lastCol, S.note);
      ws.height(row, rowHeightFor(n.text, 70));
      row += 1;
    }
  }

  row += 1;
  writeCommentsBlock(ws, row, lastCol);
}

function writeSummarySheet(wb, week, opts = {}) {
  const lastCol = 9;
  const ws = wb.addSheet("Summary", { cols: [34, 11, 11, 10, 10, 13, 15, 15, 14, 28], freeze: { rows: 4, cols: 1 } });
  ws.set(0, 0, opts.heading || `Inspect N Snap — Weekly Summary`, S.title);
  ws.merge(0, 0, 0, lastCol);
  ws.height(0, 28);
  ws.set(1, 0, `${opts.range || `Week of ${weekTitle(week.dates)}`}  ·  Generated ${new Date().toLocaleString("en-US", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" })} Toronto time`, S.subtitle);
  ws.merge(1, 0, 1, lastCol);

  const heads = ["Building", "Scheduled", "Submitted", "Partial", "Missed", "Completion", "Outside normal", "Called abnormal", "Open work orders", "Superintendent(s)"];
  heads.forEach((h, i) => ws.set(3, i, h, S.header));
  ws.height(3, 34);

  let row = 4;
  const totals = { scheduled: 0, submitted: 0, partial: 0, missed: 0, due: 0, flagged: 0, ackAbnormal: 0, open: 0 };
  for (const b of week.buildings) {
    const c = b.counts;
    ws.set(row, 0, b.name, S.bold);
    ws.set(row, 1, c.scheduled, S.center);
    ws.set(row, 2, c.submitted, S.center);
    ws.set(row, 3, c.partial, c.partial ? S.headPartial : S.center);
    ws.set(row, 4, c.missed, c.missed ? S.flag : S.center);
    if (c.due) ws.set(row, 5, c.submitted / c.due, S.percent);
    else ws.set(row, 5, "—", S.muted);
    ws.set(row, 6, c.flagged, c.flagged ? S.flag : S.center);
    ws.set(row, 7, c.ackAbnormal, S.center);
    ws.set(row, 8, b.openWorkOrders, b.openWorkOrders ? S.flag : S.center);
    ws.set(row, 9, b.authors.join(", ") || "—", S.text);
    for (const k of ["scheduled", "submitted", "partial", "missed", "due", "flagged", "ackAbnormal"]) totals[k] += c[k];
    totals.open += b.openWorkOrders;
    row += 1;
  }
  ws.set(row, 0, "All buildings", S.headNeutral);
  ws.set(row, 1, totals.scheduled, S.headNeutral);
  ws.set(row, 2, totals.submitted, S.headNeutral);
  ws.set(row, 3, totals.partial, S.headNeutral);
  ws.set(row, 4, totals.missed, S.headNeutral);
  ws.set(row, 5, totals.due ? `${Math.round((totals.submitted / totals.due) * 100)}%` : "—", S.headNeutral);
  ws.set(row, 6, totals.flagged, S.headNeutral);
  ws.set(row, 7, totals.ackAbnormal, S.headNeutral);
  ws.set(row, 8, totals.open, S.headNeutral);
  ws.set(row, 9, "", S.headNeutral);
  row += 2;

  ws.set(row, 0, "Highlights", S.section);
  row += 1;
  const lines = highlightLines(week);
  for (const line of lines) {
    ws.set(row, 0, line, S.note);
    ws.merge(row, 0, row, lastCol);
    ws.fill(row, 0, lastCol, S.note);
    ws.height(row, rowHeightFor(line, 150));
    row += 1;
  }
  row += 1;
  writeCommentsBlock(ws, row, lastCol);
}

export function highlightLines(week) {
  const lines = [];
  for (const b of week.buildings) {
    const bits = [];
    if (b.counts.missed) bits.push(`${b.counts.missed} missed day${b.counts.missed === 1 ? "" : "s"}`);
    if (b.counts.partial) bits.push(`${b.counts.partial} partial day${b.counts.partial === 1 ? "" : "s"} locked incomplete`);
    if (b.counts.flagged) {
      const top = b.flagged
        .slice(0, 3)
        .map((f) => `${readingLabel(f.tag)} ${withUnit(f.value, f.tag.unit)} on ${dayLabel(f.date)}`)
        .join("; ");
      bits.push(`${b.counts.flagged} reading${b.counts.flagged === 1 ? "" : "s"} outside normal (${top}${b.counts.flagged > 3 ? "; …" : ""})`);
    }
    if (b.openWorkOrders) bits.push(`${b.openWorkOrders} open work order${b.openWorkOrders === 1 ? "" : "s"}`);
    lines.push(bits.length ? `${b.name}: ${bits.join(" · ")}` : `${b.name}: everything on schedule, nothing outside normal.`);
  }
  return lines.length ? lines : ["No active buildings registered yet."];
}

export async function buildWeeklyReport(env, weekStartIso) {
  const weekStart = mondayOf(weekStartIso);
  const week = await gatherWeek(env, weekStart);
  const wb = new Workbook();
  writeSummarySheet(wb, week);
  for (const b of week.buildings) writeBuildingSheet(wb, b, week);
  return { bytes: wb.toBytes(), filename: reportFilename(weekStart), weekStart, week, mime: XLSX_MIME };
}

// Every value from every day on record, oldest to newest -- one sheet
// per building with a column for each recorded day.
export async function buildAllDaysReport(env) {
  const dates = await allRecordedDates(env);
  const week = await gatherRange(env, dates);
  const range = `${longDate(dates[0])}, ${dates[0].slice(0, 4)} – ${longDate(dates[dates.length - 1])}, ${dates[dates.length - 1].slice(0, 4)}`;
  const wb = new Workbook();
  writeSummarySheet(wb, week, { heading: "Inspect N Snap — All Recorded Days", range: `Every day on record: ${range}` });
  for (const b of week.buildings) {
    writeBuildingSheet(wb, b, week, {
      title: `All recorded days (${range})`,
      subtitle: "Every reading from every inspection day on record, oldest on the left. Red cells were outside normal for that reading.",
      dayWidth: 11,
    });
  }
  return { bytes: wb.toBytes(), filename: reportFilename("all"), weekStart: "all", week, mime: XLSX_MIME };
}

export const buildReport = (env, weekOrAll) => (weekOrAll === "all" ? buildAllDaysReport(env) : buildWeeklyReport(env, mondayOf(weekOrAll)));

// ----- which weeks exist ----------------------------------------------
export async function listReportWeeks(env) {
  const first = await env.DB.prepare("SELECT MIN(inspection_date) AS d FROM inspection_submissions").first();
  const today = todayIso();
  const thisMonday = mondayOf(today);
  if (!first?.d) return [{ weekStart: thisMonday, label: weekTitle(weekDates(thisMonday)), current: true }];
  const weeks = [];
  let cursor = mondayOf(first.d);
  while (cursor <= thisMonday && weeks.length < 260) {
    weeks.push({ weekStart: cursor, label: weekTitle(weekDates(cursor)), current: cursor === thisMonday });
    const next = new Date(`${cursor}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 7);
    cursor = next.toISOString().slice(0, 10);
  }
  return weeks.reverse();
}

export const isValidIsoDate = (value) => ISO_DATE.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export const isValidReportKey = (value) => value === "all" || isValidIsoDate(value);

// ----- signed download links (for the email) --------------------------
// The email attaches the spreadsheet and also links to it. GHL and mail
// clients fetch that link with no login, so it's a signed, expiring URL:
// an HMAC over (company, week, expiry) that only this Worker can mint.
// It can't be guessed or edited to point at another week or company.
function signingSecret(env) {
  return env.REPORT_SIGNING_SECRET || env.GHL_API_KEY || "";
}

async function hmacHex(env, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingSecret(env)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signedReportUrl(env, weekStart, { clientId, days = 21 } = {}) {
  const c = clientId ?? (await getNativeClientId(env));
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const sig = await hmacHex(env, `${c}.${weekStart}.${exp}`);
  const base = (env.PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  return `${base}/api/reports/weekly/file/${reportFilename(weekStart)}?c=${c}&w=${weekStart}&e=${exp}&sig=${sig}`;
}

export async function verifyReportSignature(env, { c, w, e, sig }) {
  if (!c || !isValidReportKey(w) || !e || !sig || Number(e) < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(env, `${c}.${w}.${e}`);
  if (expected.length !== String(sig).length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ String(sig).charCodeAt(i);
  return diff === 0;
}

// ----- the email --------------------------------------------------------
const esc = (v = "") => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function renderReportEmail(week, downloadUrl, filename, allDaysUrl) {
  const t = week.buildings.reduce(
    (a, b) => ({
      due: a.due + b.counts.due,
      submitted: a.submitted + b.counts.submitted,
      partial: a.partial + b.counts.partial,
      missed: a.missed + b.counts.missed,
      flagged: a.flagged + b.counts.flagged,
      open: a.open + b.openWorkOrders,
    }),
    { due: 0, submitted: 0, partial: 0, missed: 0, flagged: 0, open: 0 },
  );
  const pct = t.due ? Math.round((t.submitted / t.due) * 100) : 0;
  const tile = (label, value, sub, bad) =>
    `<td style="width:25%;padding:0 6px 0 0;vertical-align:top;"><div style="border:1px solid #dfe4df;border-radius:8px;padding:12px;">
      <div style="font-size:11px;color:#677478;text-transform:uppercase;letter-spacing:.04em;">${label}</div>
      <div style="font-size:24px;font-weight:700;margin-top:4px;${bad ? "color:#b83a2f;" : ""}">${value}</div>
      <div style="font-size:12px;color:#677478;">${sub}</div></div></td>`;

  const th = (text, align = "center") =>
    `<th style="text-align:${align};padding:8px 10px;border-bottom:2px solid #19252a;font-size:11px;text-transform:uppercase;letter-spacing:.04em;">${text}</th>`;
  const td = (html, extra = "") => `<td style="padding:9px 10px;border-bottom:1px solid #e3e8e3;text-align:center;${extra}">${html}</td>`;
  const rows = week.buildings
    .map((b) => {
      const c = b.counts;
      return `<tr>
        <td style="padding:9px 10px;border-bottom:1px solid #e3e8e3;font-weight:600;">${esc(b.name)}</td>
        ${td(c.due ? `${c.submitted} / ${c.due}` : "—")}
        ${td(c.partial || "0", c.partial ? "color:#a86b12;font-weight:700;" : "")}
        ${td(c.missed || "0", c.missed ? "color:#b83a2f;font-weight:700;" : "")}
        ${td(c.flagged || "0", c.flagged ? "color:#b83a2f;font-weight:700;" : "")}
        ${td(b.openWorkOrders || "0", b.openWorkOrders ? "color:#b83a2f;font-weight:700;" : "")}
      </tr>`;
    })
    .join("");

  const flaggedRows = week.buildings
    .flatMap((b) => b.flagged.map((f) => ({ b, f })))
    .slice(0, 15)
    .map(
      ({ b, f }) => `<tr>
        <td style="padding:7px 10px;border-bottom:1px solid #e3e8e3;">${esc(b.name)}<br><span style="color:#677478;font-size:12px;">${esc(readingLabel(f.tag))}</span></td>
        <td style="padding:7px 10px;border-bottom:1px solid #e3e8e3;text-align:center;">${esc(dayLabel(f.date))}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e3e8e3;text-align:center;font-weight:700;color:#b83a2f;">${esc(withUnit(f.value, f.tag.unit))}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #e3e8e3;font-size:12px;color:#44545a;">${esc(f.deviation.detail || "")}<br><span style="color:#677478;">${esc(answerLabel(f.deviation.ack))}</span></td>
      </tr>`,
    )
    .join("");
  const flaggedTotal = week.buildings.reduce((n, b) => n + b.flagged.length, 0);

  const noteRows = week.buildings
    .flatMap((b) => b.notes.map((n) => ({ b, n })))
    .slice(0, 12)
    .map(
      ({ b, n }) => `<li style="margin:0 0 8px;"><strong>${esc(b.name)}</strong> · ${esc(n.where)} · ${esc(dayLabel(n.date))}${n.author ? ` · ${esc(n.author)}` : ""}<br><span style="color:#44545a;">${esc(n.text)}</span></li>`,
    )
    .join("");

  return `
  <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;color:#19252a;">
    <h1 style="font-size:20px;margin:0 0 4px;">Inspect N Snap — Weekly Summary</h1>
    <p style="margin:0 0 18px;color:#677478;font-size:13px;">Week of ${esc(weekTitle(week.dates))}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;"><tr>
      ${tile("Completion", `${pct}%`, `${t.submitted} of ${t.due} inspections`, false)}
      ${tile("Outside normal", t.flagged, "readings flagged", t.flagged > 0)}
      ${tile("Partial / missed", `${t.partial} / ${t.missed}`, "days", t.missed > 0)}
      ${tile("Open orders", t.open, `across ${week.buildings.length} building${week.buildings.length === 1 ? "" : "s"}`, t.open > 0)}
    </tr></table>
    <p style="margin:0 0 22px;"><a href="${esc(downloadUrl)}" style="display:inline-block;background:#174c43;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:8px;">Download the full spreadsheet</a>
      <span style="color:#677478;font-size:12px;margin-left:8px;">${esc(filename)} is also attached — every reading by day, ready to print.</span></p>
    ${allDaysUrl ? `<p style="margin:-10px 0 22px;font-size:13px;"><a href="${esc(allDaysUrl)}" style="color:#174c43;font-weight:600;">Download every value from every day on record</a> <span style="color:#677478;">(${esc(reportFilename("all"))}, also attached)</span></p>` : ""}
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
      <thead><tr>${th("Building", "left")}${th("Submitted")}${th("Partial")}${th("Missed")}${th("Outside normal")}${th("Open orders")}</tr></thead>
      <tbody>${rows || `<tr><td colspan="6" style="padding:14px;color:#677478;">No active buildings registered yet.</td></tr>`}</tbody>
    </table>
    <h2 style="font-size:15px;margin:0 0 8px;">Readings outside normal${flaggedTotal ? ` (${flaggedTotal})` : ""}</h2>
    ${
      flaggedRows
        ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:${flaggedTotal > 15 ? "4" : "24"}px;"><tbody>${flaggedRows}</tbody></table>${flaggedTotal > 15 ? `<p style="color:#677478;font-size:12px;margin:0 0 24px;">…and ${flaggedTotal - 15} more in the spreadsheet.</p>` : ""}`
        : `<p style="color:#677478;font-size:13px;margin:0 0 24px;">Nothing was outside its normal this week.</p>`
    }
    <h2 style="font-size:15px;margin:0 0 8px;">Comments &amp; notes from the week</h2>
    ${noteRows ? `<ul style="padding-left:18px;margin:0 0 20px;font-size:13px;">${noteRows}</ul>` : `<p style="color:#677478;font-size:13px;margin:0 0 20px;">No notes were left this week.</p>`}
    <p style="margin:0 0 6px;font-size:13px;"><strong>Your comments</strong> — there's a blank "Manager comments" block at the bottom of the Summary sheet and each building's sheet, ready to write in or print.</p>
    <p style="margin-top:24px;font-size:11px;color:#8a9491;">Sent automatically every Friday at 5 PM Toronto time from Inspect N Snap. Past weeks are always available from the Weekly summaries card on your dashboard.</p>
  </div>`;
}

// Recipients: every Operations Manager with an email on file, plus any
// extra addresses in WEEKLY_REPORT_EXTRA_EMAILS (comma-separated) so the
// owner can be copied without needing a login account with an email
// (an email on a login account turns on emailed login codes).
async function reportRecipients(env) {
  const managers = (
    await env.DB.prepare(
      `SELECT id, full_name, email, ghl_contact_id FROM users
       WHERE role = 'regional_manager' AND building_access = 'all' AND status = 'active' AND is_active = 1
         AND email IS NOT NULL AND TRIM(email) != ''`,
    ).all()
  ).results.map((u) => ({ userId: u.id, name: u.full_name, email: u.email, contactId: u.ghl_contact_id }));
  const seen = new Set(managers.map((m) => m.email.toLowerCase()));
  const extras = String(env.WEEKLY_REPORT_EXTRA_EMAILS || "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e && !seen.has(e.toLowerCase()))
    .map((email) => ({ userId: null, name: email, email, contactId: null }));
  return [...managers, ...extras];
}

// `onlyTo`: send just to that address (used for testing, so a test
// never reaches the real managers).
export async function sendWeeklyReportEmail(env, { weekStart, onlyTo } = {}) {
  const start = mondayOf(weekStart || todayIso());
  const report = await buildWeeklyReport(env, start);
  const url = await signedReportUrl(env, start);
  const allDaysUrl = await signedReportUrl(env, "all");
  const html = renderReportEmail(report.week, url, report.filename, allDaysUrl);
  const subject = `Inspect N Snap weekly summary — week of ${weekTitle(report.week.dates)}`;

  const recipients = onlyTo ? [{ userId: null, name: onlyTo, email: onlyTo, contactId: null }] : await reportRecipients(env);
  const results = [];
  for (const r of recipients) {
    try {
      let contactId = r.contactId;
      if (!contactId) {
        contactId = await ghlUpsertContact(env, { email: r.email, name: r.name });
        if (r.userId) await env.DB.prepare("UPDATE users SET ghl_contact_id = ? WHERE id = ?").bind(contactId, r.userId).run();
      }
      const sent = await ghlSendEmail(env, { contactId, subject, html, attachments: [url, allDaysUrl] });
      results.push({ email: r.email, ok: true, messageId: sent?.messageId || sent?.emailMessageId || null });
    } catch (error) {
      console.error("Weekly report send failed", r.email, error);
      results.push({ email: r.email, ok: false, error: String(error) });
    }
  }
  return { weekStart: start, buildingCount: report.week.buildings.length, recipientCount: recipients.length, downloadUrl: url, allDaysUrl, results };
}
