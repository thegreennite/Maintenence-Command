// Friday analytics digest: one email per Operations Manager (every
// building_access='all' manager, not scoped to what a single ROM owns --
// an OM sees everything anyway), one summary per email covering every
// registered building's week. Reuses the same GHL sender already proven
// out for weekly 2FA -- no separate email integration to stand up.

import { ghlUpsertContact, ghlSendEmail } from "./ghl.js";
import { todayIso, weekdayName, weekDates, countExpected } from "./dashboard-data.js";

async function gatherBuildingWeeks(env) {
  const today = todayIso();
  const dates = weekDates(today);

  const buildings = await env.DB.prepare(
    "SELECT id, name, inspection_days FROM buildings WHERE status = 'active' AND deleted_at IS NULL ORDER BY name",
  ).all();
  const rows = buildings.results;
  if (!rows.length) return [];

  const buildingIds = rows.map((b) => b.id);
  const placeholders = buildingIds.map(() => "?").join(",");

  const [submitted, openOrders, supers] = await Promise.all([
    env.DB.prepare(
      `SELECT building_id, inspection_date FROM inspection_submissions
       WHERE status = 'submitted' AND building_id IN (${placeholders}) AND inspection_date IN (${dates.map(() => "?").join(",")})`,
    )
      .bind(...buildingIds, ...dates)
      .all(),
    env.DB.prepare(
      `SELECT building_id, COUNT(*) AS c FROM work_orders WHERE status = 'open' AND building_id IN (${placeholders}) GROUP BY building_id`,
    )
      .bind(...buildingIds)
      .all(),
    env.DB.prepare(
      `SELECT building_id, COUNT(*) AS c FROM users WHERE role = 'superintendent' AND status = 'active' AND building_id IN (${placeholders}) GROUP BY building_id`,
    )
      .bind(...buildingIds)
      .all(),
  ]);

  const submittedByBuilding = new Map();
  for (const row of submitted.results) {
    submittedByBuilding.set(row.building_id, (submittedByBuilding.get(row.building_id) || 0) + 1);
  }
  const openByBuilding = new Map(openOrders.results.map((r) => [r.building_id, r.c]));
  const supersByBuilding = new Map(supers.results.map((r) => [r.building_id, r.c]));
  const todayWeekday = weekdayName(today);

  return rows.map((b) => {
    const expected = countExpected([b], dates);
    return {
      id: b.id,
      name: b.name,
      completed: submittedByBuilding.get(b.id) || 0,
      expected,
      openWorkOrders: openByBuilding.get(b.id) || 0,
      superintendents: supersByBuilding.get(b.id) || 0,
      dueTodayNotYet: (b.inspection_days || "").split(",").includes(todayWeekday) && !submittedByBuilding.has(b.id),
    };
  });
}

function weekLabel(dates) {
  const start = new Date(`${dates[0]}T00:00:00`);
  const end = new Date(`${dates[4]}T00:00:00`); // Friday, when this actually goes out
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function renderDigestHtml(buildingWeeks, dates) {
  const totalExpected = buildingWeeks.reduce((sum, b) => sum + b.expected, 0);
  const totalCompleted = buildingWeeks.reduce((sum, b) => sum + b.completed, 0);
  const totalOpen = buildingWeeks.reduce((sum, b) => sum + b.openWorkOrders, 0);
  const pct = totalExpected ? Math.round((totalCompleted / totalExpected) * 100) : 0;

  const rows = buildingWeeks
    .map((b) => {
      const flag = b.dueTodayNotYet ? ' <span style="color:#b83a2f;font-weight:700;">· due today, not yet submitted</span>' : "";
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e3e8e3;font-weight:600;">${escapeHtml(b.name)}${flag}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e3e8e3;text-align:center;">${b.completed} / ${b.expected}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e3e8e3;text-align:center;${b.openWorkOrders ? "color:#b83a2f;font-weight:700;" : ""}">${b.openWorkOrders}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e3e8e3;text-align:center;">${b.superintendents}</td>
      </tr>`;
    })
    .join("");

  return `
    <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#19252a;">
      <h1 style="font-size:20px;margin:0 0 4px;">FHG Command — Weekly Summary</h1>
      <p style="margin:0 0 20px;color:#677478;font-size:13px;">Week of ${weekLabel(dates)}</p>
      <div style="display:flex;gap:12px;margin-bottom:24px;">
        <div style="flex:1;border:1px solid #dfe4df;border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:#677478;text-transform:uppercase;letter-spacing:.04em;">Portfolio completion</div>
          <div style="font-size:24px;font-weight:700;margin-top:4px;">${pct}%</div>
          <div style="font-size:12px;color:#677478;">${totalCompleted} of ${totalExpected} inspections</div>
        </div>
        <div style="flex:1;border:1px solid #dfe4df;border-radius:8px;padding:14px;">
          <div style="font-size:11px;color:#677478;text-transform:uppercase;letter-spacing:.04em;">Open work orders</div>
          <div style="font-size:24px;font-weight:700;margin-top:4px;${totalOpen ? "color:#b83a2f;" : ""}">${totalOpen}</div>
          <div style="font-size:12px;color:#677478;">Across ${buildingWeeks.length} building${buildingWeeks.length === 1 ? "" : "s"}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #19252a;font-size:11px;text-transform:uppercase;letter-spacing:.04em;">Building</th>
            <th style="text-align:center;padding:8px 12px;border-bottom:2px solid #19252a;font-size:11px;text-transform:uppercase;letter-spacing:.04em;">Submitted</th>
            <th style="text-align:center;padding:8px 12px;border-bottom:2px solid #19252a;font-size:11px;text-transform:uppercase;letter-spacing:.04em;">Open orders</th>
            <th style="text-align:center;padding:8px 12px;border-bottom:2px solid #19252a;font-size:11px;text-transform:uppercase;letter-spacing:.04em;">Supers</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="4" style="padding:14px;color:#677478;">No active buildings registered yet.</td></tr>`}</tbody>
      </table>
      <p style="margin-top:24px;font-size:11px;color:#8a9491;">Sent automatically every Friday from FHG Command. Sign in for live detail: view work orders, coverage, and per-reading history for any building.</p>
    </div>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// The actual send -- called both by the Friday cron and by an
// admin-triggered "send now" for testing without waiting for Friday.
export async function sendWeeklyDigest(env) {
  const buildingWeeks = await gatherBuildingWeeks(env);
  const dates = weekDates(todayIso());
  const html = renderDigestHtml(buildingWeeks, dates);
  const subject = `FHG Command weekly summary — week of ${weekLabel(dates)}`;

  const recipients = await env.DB.prepare(
    `SELECT id, full_name, email, ghl_contact_id FROM users
     WHERE role = 'regional_manager' AND building_access = 'all' AND status = 'active' AND is_active = 1
       AND email IS NOT NULL AND TRIM(email) != ''`,
  ).all();

  const results = [];
  for (const recipient of recipients.results) {
    try {
      let contactId = recipient.ghl_contact_id;
      if (!contactId) {
        contactId = await ghlUpsertContact(env, { email: recipient.email, name: recipient.full_name });
        await env.DB.prepare("UPDATE users SET ghl_contact_id = ? WHERE id = ?").bind(contactId, recipient.id).run();
      }
      await ghlSendEmail(env, { contactId, subject, html });
      results.push({ userId: recipient.id, email: recipient.email, ok: true });
    } catch (error) {
      console.error("Weekly digest send failed", recipient.email, error);
      results.push({ userId: recipient.id, email: recipient.email, ok: false, error: String(error) });
    }
  }

  return { buildingCount: buildingWeeks.length, recipientCount: recipients.results.length, results };
}
