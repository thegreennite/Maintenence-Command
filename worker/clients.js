// The agency's cross-company view: list every company, switch into one
// to see its data exactly as that company's own admin would, and the
// self-serve "Add a business" signup that provisions a brand-new
// company (its own dedicated D1 database) on the spot.

import { dbForClient, provisionCompanyDatabase, recordLoginDirectory, createAgencyCompanySession } from "./tenant-db.js";
import { hashPassword } from "./security.js";
import { ghlUpsertContact, ghlSendEmail } from "./ghl.js";

const PLAN_BUILDING_LIMITS = { basic: 10, plus: 50, pro: null };

function requireAgency(session, corsHeaders) {
  if (!session.isAgency) return jsonError("Agency access required.", 403, corsHeaders);
  return null;
}

export async function handleListClients(session, env, corsHeaders) {
  const deny = requireAgency(session, corsHeaders);
  if (deny) return deny;

  const result = await env.CONTROL_DB.prepare(
    "SELECT id, name, plan, building_limit, status, database_kind, created_at FROM clients ORDER BY name",
  ).all();
  return jsonOk({ clients: result.results }, corsHeaders);
}

// Sets which company the agency session is "inside" -- from here on,
// requireSession resolves a REAL session for the agency's own local
// identity in that company's database (see ensureAgencyUserRow /
// createAgencyCompanySession in tenant-db.js), so it behaves exactly
// like that company's own admin everywhere, including impersonation.
// clientId omitted/null returns to the broad, all-companies view.
export async function handleSwitchClient(request, session, env, corsHeaders) {
  const deny = requireAgency(session, corsHeaders);
  if (deny) return deny;

  const body = await request.json().catch(() => ({}));
  const clientId = body.clientId == null ? null : Number.parseInt(body.clientId, 10);

  let newCompanySessionId = null;
  if (clientId != null) {
    const resolved = await dbForClient(env, clientId);
    if (!resolved) return jsonError("Company not found.", 404, corsHeaders);
    newCompanySessionId = await createAgencyCompanySession(resolved.db);
  }

  // Best-effort cleanup of the session row left behind in whichever
  // company this agency session was previously inside -- not load-
  // bearing (it just expires on its own otherwise), so a failure here
  // never blocks the actual switch.
  const previous = await env.CONTROL_DB.prepare("SELECT active_client_id, company_session_id FROM agency_sessions WHERE id = ?")
    .bind(session.session_id)
    .first();
  if (previous?.active_client_id && previous.company_session_id) {
    try {
      const oldResolved = await dbForClient(env, previous.active_client_id);
      if (oldResolved) await oldResolved.db.prepare("DELETE FROM sessions WHERE id = ?").bind(previous.company_session_id).run();
    } catch {
      // Non-critical -- see comment above.
    }
  }

  await env.CONTROL_DB.prepare("UPDATE agency_sessions SET active_client_id = ?, company_session_id = ? WHERE id = ?")
    .bind(clientId, newCompanySessionId, session.session_id)
    .run();

  return jsonOk({ ok: true, activeClientId: clientId }, corsHeaders);
}

// Self-serve company signup -- "Add a business" on the login screen.
// Instant: no approval step, the new Operations Manager account is
// usable the moment this returns (per plan). Not gated behind an
// authenticated session at all -- this IS how a session gets created
// for a brand-new company.
export async function handleCreateBusiness(request, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const companyName = String(body.companyName || "").trim();
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();

  if (!companyName || !fullName || !email) {
    return jsonError("Company name, your name, and email are required.", 400, corsHeaders);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError("Enter a valid email address.", 400, corsHeaders);
  }

  const existing = await env.CONTROL_DB.prepare("SELECT client_id FROM login_directory WHERE email = ?")
    .bind(email)
    .first();
  if (existing) return jsonError("An account already exists for that email.", 409, corsHeaders);

  // Migration SQL is bundled at build time (see
  // scripts/bundle-migrations.mjs -> worker/migrations-bundle.js) since a
  // Worker can't read arbitrary files off disk at runtime.
  const { COMPANY_MIGRATIONS } = await import("./migrations-bundle.js");

  const plan = "basic";
  const buildingLimit = PLAN_BUILDING_LIMITS[plan];

  let provisioned;
  try {
    provisioned = await provisionCompanyDatabase(env, {
      name: companyName,
      plan,
      buildingLimit,
      migrationSql: COMPANY_MIGRATIONS,
    });
  } catch (error) {
    console.error("Company provisioning failed", error);
    return jsonError("Couldn't set up your company right now. Try again in a moment.", 502, corsHeaders);
  }

  const { client, db } = provisioned;

  // Temp password -- emailed below, same pattern as admin-created
  // accounts elsewhere in this app. The OM can change it after signing in.
  const tempPassword = generateTempPassword();
  const { salt, hash } = await hashPassword(tempPassword);

  // client_id = 1 -- the local self-id inside this company's own brand
  // new database (see LOCAL_CLIENT_SCHEMA_SQL in tenant-db.js). Every
  // clientScopeSql check throughout worker/*.js compares against this
  // column, and `= NULL` never matches in SQL -- leaving it unset would
  // silently make this OM's own account unable to see anything it
  // creates.
  await db.prepare(
    `INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, building_access, email, phone, status, is_active, contact_consent, contact_consent_at, client_id)
     VALUES (?, ?, ?, ?, 'Operations Manager', 'regional_manager', 'all', ?, ?, 'active', 1, 1, CURRENT_TIMESTAMP, 1)`,
  )
    .bind(email, hash, salt, fullName, email, phone || null)
    .run();

  await recordLoginDirectory(env, email, client.id);

  try {
    const contactId = await ghlUpsertContact(env, { email, name: fullName });
    await ghlSendEmail(env, {
      contactId,
      subject: `Your Inspect Funnel account for ${companyName} is ready`,
      html: `<p>Hi ${fullName},</p>
        <p>Your Inspect Funnel account for <strong>${companyName}</strong> is set up. Sign in with:</p>
        <p>Email: ${email}<br>Temporary password: <strong>${tempPassword}</strong></p>
        <p>You're set up as the Operations Manager -- from here you can add Area Managers and Superintendents, and start registering buildings.</p>`,
    });
  } catch (error) {
    // The account is real and usable even if the email fails to send --
    // don't fail the whole signup over it, but don't swallow it silently.
    console.error("Welcome email failed for new company", companyName, error);
  }

  return jsonOk(
    { ok: true, message: `${companyName} is ready. Check ${email} for your login details.` },
    corsHeaders,
  );
}

function generateTempPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return "PLC-" + Array.from(bytes, (b) => b.toString(36)).join("").slice(0, 12);
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
