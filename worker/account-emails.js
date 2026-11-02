// Emails people get around signing up:
//   - "welcome"   : the account works now (a property manager on sign-up, or
//                   anyone the moment a manager approves them).
//   - "received"  : sign-up needs approval; confirms the request arrived and
//                   who decides.
// Sent through GoHighLevel like every other email here. Best-effort: a hiccup
// sending one must never fail the sign-up or the approval itself.

import { ghlUpsertContact, ghlSendEmail } from "./ghl.js";

const DEFAULT_APP_URL = "https://revinetic.com/inspect-funnels";

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const ROLE_NOTES = {
  property_manager:
    "You'll see your building's daily inspections, any readings outside normal with the superintendent's remarks, and messages from the superintendent. You also get an email whenever a reading is reported abnormal.",
  superintendent:
    "Each inspection day, open the app and tap Start inspection. It walks you through every reading and asks for a photo of each machine. For the first 3 days it only learns, so enter exactly what each gauge shows.",
  cleaner: "Your daily task checklist shows up in the app once your manager assigns you a schedule.",
  regional_manager:
    "Add your buildings, assign superintendents, and review the exceptions queue. Every Friday the weekly report arrives by email.",
};

function layout(title, bodyHtml, appUrl) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#19252a">
    <div style="padding:22px 0 12px"><strong style="font-size:18px;color:#174c43">Inspect Funnels</strong></div>
    <h2 style="margin:0 0 12px;font-size:22px;line-height:1.3">${title}</h2>
    ${bodyHtml}
    <p style="margin:24px 0"><a href="${appUrl}" style="display:inline-block;background:#174c43;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px">Open Inspect Funnels</a></p>
    <p style="margin:0;color:#677478;font-size:12px;line-height:1.5">When you sign in, we email you a 6-digit code to confirm it's you (about once a week). Add the app to your home screen from the sign-in page for one-tap access.</p>
  </div>`;
}

// user: { id, full_name, email, username, role, building_access, ghl_contact_id }
export async function sendAccountEmail(env, db, user, kind, { buildingName, approver } = {}) {
  if (!env.GHL_API_KEY || !env.GHL_LOCATION_ID) return { sent: false, skipped: "ghl-not-configured" };
  const email = user.email || (String(user.username || "").includes("@") ? user.username : null);
  if (!email) return { sent: false, skipped: "no-email" };
  const appUrl = (env.PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
  const firstName = esc(String(user.full_name || "").split(" ")[0] || "there");
  const roleLabel = { property_manager: "Property Manager", superintendent: "Superintendent", cleaner: "Cleaner" }[user.role] ||
    (user.building_access === "all" ? "Operations Manager" : "Area Manager");
  const where = buildingName ? ` for <strong>${esc(buildingName)}</strong>` : "";
  const note = ROLE_NOTES[user.role] || "";

  const subject =
    kind === "welcome" ? "Welcome to Inspect Funnels — your account is ready" : "We received your Inspect Funnels sign-up";
  const html =
    kind === "welcome"
      ? layout(
          `Welcome, ${firstName}`,
          `<p style="margin:0 0 12px;line-height:1.55">Your <strong>${esc(roleLabel)}</strong> account${where} is ready. Sign in with <strong>${esc(email)}</strong> and the password you chose.</p>
           ${note ? `<p style="margin:0 0 12px;line-height:1.55;color:#3c4a4e">${esc(note)}</p>` : ""}`,
          appUrl,
        )
      : layout(
          `Thanks, ${firstName} — request received`,
          `<p style="margin:0 0 12px;line-height:1.55">Your sign-up as a <strong>${esc(roleLabel)}</strong>${where} has been sent to ${esc(approver || "your operations manager")} for approval.</p>
           <p style="margin:0 0 12px;line-height:1.55;color:#3c4a4e">We'll email you again as soon as you're approved, and then you can sign in with <strong>${esc(email)}</strong>.</p>`,
          appUrl,
        );

  try {
    let contactId = user.ghl_contact_id;
    if (!contactId) {
      contactId = await ghlUpsertContact(env, { email, name: user.full_name });
      if (user.id) await db.prepare("UPDATE users SET ghl_contact_id = ? WHERE id = ?").bind(contactId, user.id).run();
    }
    await ghlSendEmail(env, { contactId, subject, html });
    return { sent: true };
  } catch (error) {
    console.error(`Account email (${kind}) failed for`, email, error);
    return { sent: false, error: String(error?.message || error) };
  }
}

// Looks the account up by id and sends; used after sign-up and on approval.
export async function sendAccountEmailFor(env, db, userId, kind, opts = {}) {
  const user = await db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.username, u.role, u.building_access, u.ghl_contact_id, b.name AS building_name
       FROM users u LEFT JOIN buildings b ON b.id = u.building_id WHERE u.id = ?`,
    )
    .bind(userId)
    .first();
  if (!user) return { sent: false, skipped: "not-found" };
  return sendAccountEmail(env, db, user, kind, { buildingName: user.building_name, ...opts });
}
