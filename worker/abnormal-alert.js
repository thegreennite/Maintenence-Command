// Email the property manager when a superintendent submits an inspection with
// readings they confirmed as abnormal.
//
// TEST SETUP: until real property-manager accounts are wired in, every alert goes to
// the address below. Set ABNORMAL_ALERT_EMAILS (comma separated) on the Worker to
// change who gets them without touching code.

import { ghlUpsertContact, ghlSendEmail } from "./ghl.js";
import { readingText } from "../shared/reading-unit.js";

const TEST_PM_EMAIL = "lucas.garcia.gla@gmail.com";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function alertRecipients(env) {
  const configured = String(env.ABNORMAL_ALERT_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
  return configured.length ? configured : [TEST_PM_EMAIL];
}

export async function sendAbnormalAlert(env, { buildingId, submissionId, superName, abnormalTagIds }) {
  const ids = [...new Set((abnormalTagIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return { sent: 0 };

  const placeholders = ids.map(() => "?").join(",");
  const [building, rows] = await Promise.all([
    env.DB.prepare("SELECT name FROM buildings WHERE id = ?").bind(buildingId).first(),
    env.DB.prepare(
      `SELECT t.id, t.system_name, t.tag_no, t.reading_type, t.unit, g.name AS group_name, r.value, r.deviation
       FROM inspection_readings r
       JOIN inspection_tags t ON t.id = r.tag_id
       LEFT JOIN equipment_groups g ON g.id = t.equipment_group_id
       WHERE r.submission_id = ? AND r.tag_id IN (${placeholders}) ORDER BY t.sort_order`,
    )
      .bind(submissionId, ...ids)
      .all(),
  ]);
  if (!rows.results.length) return { sent: 0 };

  const items = rows.results.map((row) => {
    let deviation = null;
    try {
      deviation = row.deviation ? JSON.parse(row.deviation) : null;
    } catch {
      deviation = null;
    }
    const where = [row.group_name || row.system_name, [row.tag_no, row.reading_type].filter(Boolean).join(" — ")].filter(Boolean).join(" · ");
    return { where, value: readingText(row.value, row.unit), state: deviation?.state || "", detail: deviation?.detail || "" };
  });

  const buildingName = building?.name || "your building";
  const subject = `Abnormal ${items.length === 1 ? "reading" : "readings"} at ${buildingName}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1b2a28">
    <h2 style="margin:0 0 6px">Abnormal ${items.length === 1 ? "reading" : "readings"} — ${esc(buildingName)}</h2>
    <p style="margin:0 0 16px;color:#5b6b68">${esc(superName || "The superintendent")} confirmed ${items.length === 1 ? "this reading as" : "these readings as"} abnormal when submitting today's inspection.</p>
    <table style="border-collapse:collapse;width:100%">${items
      .map(
        (i) => `<tr><td style="padding:9px 10px;border-bottom:1px solid #e3e8e3"><strong>${esc(i.where)}</strong>${i.state ? `<br><span style="color:#5b6b68;font-size:12px">machine was ${esc(i.state)}</span>` : ""}${i.detail ? `<br><span style="color:#5b6b68;font-size:12px">${esc(i.detail)}</span>` : ""}</td>
        <td style="padding:9px 10px;border-bottom:1px solid #e3e8e3;text-align:right;font-weight:700;color:#b83a2f;white-space:nowrap">${esc(i.value)}</td></tr>`,
      )
      .join("")}</table>
    <p style="margin:16px 0 0;color:#5b6b68;font-size:12px">Sent by Inspect Funnels.</p></div>`;

  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) {
    console.warn("Abnormal alert not sent: GHL is not configured on this Worker.", { to: alertRecipients(env), subject });
    return { sent: 0, skipped: "ghl-not-configured" };
  }
  let sent = 0;
  for (const email of alertRecipients(env)) {
    try {
      const contactId = await ghlUpsertContact(env, { email, name: "Property manager" });
      await ghlSendEmail(env, { contactId, subject, html });
      sent += 1;
    } catch (error) {
      console.error("Abnormal alert email failed for", email, error);
    }
  }
  return { sent };
}
