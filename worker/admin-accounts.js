// Admin-only account management: "get rid of" a profile (soft-delete --
// blocks login and disappears from every list, but existing inspection
// history still shows their name, same non-destructive philosophy as
// building deletion) and classify one (a free-form-ish label, used right
// now to gate the AI photo-reading feature to just the beta tester --
// see CLASSIFICATIONS below and its use in worker/vision.js). Also:
// create an account outright, skipping the self-register + approval
// dance -- an admin adding someone IS the approval.

import { hashPassword } from "./security.js";
import { cleanDesignation } from "./roles.js";
import { effectiveClientId } from "./access.js";
import { recordLoginDirectory } from "./tenant-db.js";

export const CLASSIFICATIONS = {
  standard: "Standard",
  beta_tester: "Beta Tester",
};

// role value the admin picks -> {db role, building_access, job title}.
// ROM and OM share one db role ("regional_manager"), split by
// building_access (see worker/access.js); everyone else maps straight
// through.
// building_access is NOT NULL and only actually distinguishes ROM ("own")
// from OM ("all") -- for every other role it's ignored, so default it to
// "own" rather than leaving it null.
const CREATABLE_ROLES = {
  superintendent: { role: "superintendent", access: "own", title: "Superintendent" },
  cleaner: { role: "cleaner", access: "own", title: "Cleaner" },
  property_manager: { role: "property_manager", access: "own", title: "Property Manager" },
  regional_manager: { role: "regional_manager", access: "own", title: "Area Manager" },
  operations_manager: { role: "regional_manager", access: "all", title: "Operations Manager" },
  admin: { role: "admin", access: "own", title: "Administrator" },
};

function requireAdmin(session, corsHeaders) {
  if (session.role !== "admin") {
    return jsonError("Administrator access required.", 403, corsHeaders);
  }
  return null;
}

export async function handleCreateAccount(request, session, env, corsHeaders) {
  const deny = requireAdmin(session, corsHeaders);
  if (deny) return deny;

  const body = await request.json().catch(() => ({}));
  const spec = CREATABLE_ROLES[String(body.role || "")];
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");
  const regionName = String(body.regionName || "").trim();
  const buildingId = body.buildingId ? Number.parseInt(body.buildingId, 10) : null;
  const designation = cleanDesignation(body.designation);

  if (!spec) return jsonError("Choose a role.", 400, corsHeaders);
  if (!fullName || !email) return jsonError("Name and email are required.", 400, corsHeaders);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError("That email doesn't look right.", 400, corsHeaders);
  if (password.length < 8) return jsonError("Set a password of at least 8 characters.", 400, corsHeaders);

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? OR username = ?").bind(email, email).first();
  if (existing) return jsonError("An account already exists for that email.", 409, corsHeaders);

  const isFieldTier = spec.role === "superintendent" || spec.role === "cleaner" || spec.role === "property_manager";
  let building = null;
  if (isFieldTier) {
    if (!buildingId) return jsonError("Pick which building this person works at.", 400, corsHeaders);
    building = await env.DB.prepare("SELECT id, region FROM buildings WHERE id = ? AND deleted_at IS NULL")
      .bind(buildingId)
      .first();
    if (!building) return jsonError("Building not found.", 404, corsHeaders);
  }

  const { salt, hash } = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, building_access, region, building_id, email, phone, status, is_active, contact_consent, contact_consent_at, client_id, designation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 1, CURRENT_TIMESTAMP, ?, ?)`,
  )
    .bind(
      email,
      hash,
      salt,
      fullName,
      spec.title,
      spec.role,
      spec.access,
      isFieldTier ? building.region : regionName || null,
      isFieldTier ? building.id : null,
      email,
      phone || null,
      effectiveClientId(session),
      // A designation only means something on the field roles.
      spec.role === "superintendent" || spec.role === "cleaner" ? designation : null,
    )
    .run();
  // session.companyId is the control-plane id (which company, globally --
  // not the local-to-this-database id effectiveClientId returns above),
  // exactly what the login directory needs to route this person's next
  // sign-in to the right database.
  if (session.companyId) await recordLoginDirectory(env, email, session.companyId);

  return jsonOk({ ok: true, username: email }, corsHeaders);
}

export async function handleRemoveAccount(request, session, env, corsHeaders) {
  const deny = requireAdmin(session, corsHeaders);
  if (deny) return deny;

  const body = await request.json().catch(() => ({}));
  const userId = Number.parseInt(body.userId, 10);
  if (userId === session.id) return jsonError("You can't remove your own account.", 400, corsHeaders);

  const target = await env.DB.prepare("SELECT id, role, is_active FROM users WHERE id = ?").bind(userId).first();
  if (!target) return jsonError("Account not found.", 404, corsHeaders);
  if (target.role === "admin") return jsonError("Administrator accounts can't be removed here.", 400, corsHeaders);
  if (!target.is_active) return jsonError("That account is already removed.", 400, corsHeaders);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET is_active = 0, removed_at = CURRENT_TIMESTAMP, building_id = NULL WHERE id = ?").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? OR actor_user_id = ?").bind(userId, userId),
  ]);
  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleRestoreAccount(request, session, env, corsHeaders) {
  const deny = requireAdmin(session, corsHeaders);
  if (deny) return deny;

  const body = await request.json().catch(() => ({}));
  const userId = Number.parseInt(body.userId, 10);
  const result = await env.DB.prepare(
    "UPDATE users SET is_active = 1, removed_at = NULL WHERE id = ? AND removed_at IS NOT NULL",
  )
    .bind(userId)
    .run();
  if (!result.meta.changes) return jsonError("That account isn't in the removed list.", 404, corsHeaders);
  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleRemovedAccountsList(session, env, corsHeaders) {
  const deny = requireAdmin(session, corsHeaders);
  if (deny) return deny;

  const result = await env.DB.prepare(
    `SELECT id, username, full_name, job_title, role, removed_at
     FROM users WHERE removed_at IS NOT NULL AND username NOT LIKE 'purged-%' ORDER BY removed_at DESC`,
  ).all();
  return jsonOk({ accounts: result.results }, corsHeaders);
}

export async function handleSetClassification(request, session, env, corsHeaders) {
  const deny = requireAdmin(session, corsHeaders);
  if (deny) return deny;

  const body = await request.json().catch(() => ({}));
  const userId = Number.parseInt(body.userId, 10);
  const classification = String(body.classification || "");
  if (!CLASSIFICATIONS[classification]) return jsonError("Not a valid classification.", 400, corsHeaders);

  const result = await env.DB.prepare("UPDATE users SET classification = ? WHERE id = ? AND is_active = 1")
    .bind(classification, userId)
    .run();
  if (!result.meta.changes) return jsonError("Account not found.", 404, corsHeaders);
  return jsonOk({ ok: true }, corsHeaders);
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
