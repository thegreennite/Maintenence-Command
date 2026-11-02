// Remarks: a superintendent's short note about one reading (the pencil in
// command mode). Saved with the inspection, shown in the Friday spreadsheet,
// and -- if the super chooses at submit -- sent to the building's Area Managers
// and the Operations Managers as an observation. Always in English
// (shared/english-only.js), whatever language the app is shown in.
//
// Own table, created on demand, since company databases have no migration tooling.

import { isEnglish, ENGLISH_ONLY_MESSAGE } from "../shared/english-only.js";
import { readingText } from "../shared/reading-unit.js";
import { ghlUpsertContact, ghlSendEmail } from "./ghl.js";

const MAX_REMARK = 500;
const ready = new WeakSet();

async function ensureRemarksTable(db) {
  if (ready.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS reading_remarks (
         submission_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, remark TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (submission_id, tag_id))`,
    )
    .run();
  ready.add(db);
}

export function englishError(...texts) {
  return texts.some((t) => !isEnglish(t)) ? ENGLISH_ONLY_MESSAGE : null;
}

// remarks: { [tagId]: text } -- an empty text removes that remark.
export async function saveRemarks(env, submissionId, validTagIds, remarks) {
  const entries = Object.entries(remarks || {})
    .map(([id, text]) => [Number.parseInt(id, 10), String(text ?? "").trim().slice(0, MAX_REMARK)])
    .filter(([id]) => validTagIds.has(id));
  if (!entries.length) return;
  await ensureRemarksTable(env.DB);
  await env.DB.batch(
    entries.map(([id, text]) =>
      text
        ? env.DB.prepare(
            `INSERT INTO reading_remarks (submission_id, tag_id, remark) VALUES (?, ?, ?)
             ON CONFLICT (submission_id, tag_id) DO UPDATE SET remark = excluded.remark, updated_at = CURRENT_TIMESTAMP`,
          ).bind(submissionId, id, text)
        : env.DB.prepare("DELETE FROM reading_remarks WHERE submission_id = ? AND tag_id = ?").bind(submissionId, id),
    ),
  );
}

// { [tagId]: text } for one inspection.
export async function loadRemarks(env, submissionId) {
  if (!submissionId) return {};
  await ensureRemarksTable(env.DB);
  const rows = await env.DB.prepare("SELECT tag_id, remark FROM reading_remarks WHERE submission_id = ?").bind(submissionId).all();
  return Object.fromEntries(rows.results.map((r) => [r.tag_id, r.remark]));
}

// Map of `${submissionId}|${tagId}` -> text, for the weekly spreadsheet.
export async function remarksForSubmissions(env, submissionIds) {
  const ids = [...new Set(submissionIds)].filter(Boolean);
  if (!ids.length) return new Map();
  await ensureRemarksTable(env.DB);
  const rows = await env.DB.prepare(
    `SELECT submission_id, tag_id, remark FROM reading_remarks WHERE submission_id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all();
  return new Map(rows.results.map((r) => [`${r.submission_id}|${r.tag_id}`, r.remark]));
}

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The building's Area Managers (registered or share it) and every Operations Manager.
async function managementFor(env, buildingId) {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT u.id, u.full_name, u.email, u.ghl_contact_id FROM users u
     WHERE u.role = 'regional_manager' AND u.is_active = 1 AND u.status = 'active'
       AND u.email IS NOT NULL AND TRIM(u.email) != ''
       AND (u.building_access = 'all'
         OR u.id = (SELECT created_by FROM buildings WHERE id = ?)
         OR u.id IN (SELECT user_id FROM building_managers WHERE building_id = ?))`,
  )
    .bind(buildingId, buildingId)
    .all();
  return rows.results;
}

// Sent at submit when the super ticks "send my remarks to management". Also kept
// as a work order (category 'observation') so it shows on the managers' and the
// property manager's dashboards, not just in an inbox.
export async function sendObservation(env, { buildingId, submissionId, superId, superName }) {
  const remarks = await loadRemarks(env, submissionId);
  const tagIds = Object.keys(remarks).map(Number);
  if (!tagIds.length) return { sent: 0 };
  const [building, rows] = await Promise.all([
    env.DB.prepare("SELECT name FROM buildings WHERE id = ?").bind(buildingId).first(),
    env.DB.prepare(
      `SELECT t.id, t.tag_no, t.reading_type, t.unit, g.name AS group_name, r.value FROM inspection_tags t
       LEFT JOIN equipment_groups g ON g.id = t.equipment_group_id
       LEFT JOIN inspection_readings r ON r.tag_id = t.id AND r.submission_id = ?
       WHERE t.id IN (${tagIds.map(() => "?").join(",")}) ORDER BY t.sort_order`,
    )
      .bind(submissionId, ...tagIds)
      .all(),
  ]);
  const items = rows.results.map((row) => ({
    where: [row.group_name, [row.tag_no, row.reading_type].filter(Boolean).join(" — ")].filter(Boolean).join(" · "),
    value: row.value ? readingText(row.value, row.unit) : "",
    remark: remarks[row.id],
  }));
  const buildingName = building?.name || "your building";

  await env.DB.prepare(
    `INSERT INTO work_orders (building_id, created_by, source, category, title, description) VALUES (?, ?, 'flagged', 'observation', ?, ?)`,
  )
    .bind(
      buildingId,
      superId,
      `Observation on ${items.length === 1 ? "a reading" : `${items.length} readings`}`,
      items.map((i) => `${i.where}${i.value ? ` (${i.value})` : ""}: ${i.remark}`).join("\n"),
    )
    .run();

  const recipients = await managementFor(env, buildingId);
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID || !recipients.length) return { sent: 0, saved: true };
  const subject = `Observation from ${superName || "the superintendent"} at ${buildingName}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1b2a28">
    <h2 style="margin:0 0 6px">Observation — ${esc(buildingName)}</h2>
    <p style="margin:0 0 16px;color:#5b6b68">${esc(superName || "The superintendent")} left these remarks on today's inspection and asked for them to go to management.</p>
    <table style="border-collapse:collapse;width:100%">${items
      .map(
        (i) => `<tr><td style="padding:9px 10px;border-bottom:1px solid #e3e8e3"><strong>${esc(i.where)}</strong>${i.value ? ` <span style="color:#5b6b68">· ${esc(i.value)}</span>` : ""}<br>${esc(i.remark)}</td></tr>`,
      )
      .join("")}</table>
    <p style="margin:16px 0 0;color:#5b6b68;font-size:12px">Sent by Inspect Funnels.</p>
  </div>`;
  let sent = 0;
  for (const r of recipients) {
    try {
      const contactId = r.ghl_contact_id || (await ghlUpsertContact(env, { email: r.email, name: r.full_name }));
      await ghlSendEmail(env, { contactId, subject, html });
      sent += 1;
    } catch (error) {
      console.error("Observation email failed", r.email, error);
    }
  }
  return { sent, saved: true };
}
