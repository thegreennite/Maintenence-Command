// Self-registration: anyone can sign up as Superintendent, Property
// Manager, Regional Operations Manager, or Operations Manager. Super/PM
// register against an existing building and wait on whoever registered
// that building to approve them. A Regional/Operations Manager registers
// with a region/team name and waits on an Administrator instead -- there's
// no "manager of managers" otherwise.
//
// ROM and OM are the same `role` value in the database (regional_manager)
// -- OM is distinguished by building_access = 'all' (see worker/access.js).

import { hashPassword } from "./security.js";
import { canSeeAllBuildings, ownedOrSharedSql } from "./access.js";

const SELF_SERVE_ROLES = new Set(["superintendent", "property_manager", "regional_manager", "operations_manager"]);
const JOB_TITLES = {
  superintendent: "Superintendent",
  property_manager: "Property Manager",
  regional_manager: "Regional Operations Manager",
  operations_manager: "Operations Manager",
};

export async function handleBuildingSearchForRegistration(request, env, corsHeaders) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return jsonOk({ buildings: [] }, corsHeaders);

  const result = await env.DB.prepare(
    `SELECT id, name, address FROM buildings WHERE deleted_at IS NULL AND name LIKE ? ORDER BY name LIMIT 10`,
  )
    .bind(`%${q}%`)
    .all();
  return jsonOk({ buildings: result.results }, corsHeaders);
}

export async function handleSelfRegister(request, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const requestedRole = String(body.role || "");
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");
  const buildingId = Number.parseInt(body.buildingId, 10);
  const regionName = String(body.regionName || "").trim();
  const profilePhoto = typeof body.profilePhoto === "string" ? body.profilePhoto : null;
  const contactConsent = body.contactConsent === true;

  if (!SELF_SERVE_ROLES.has(requestedRole)) {
    return jsonError("Choose your role.", 400, corsHeaders);
  }
  if (!fullName || !email || !password) {
    return jsonError("Name, email, and password are required.", 400, corsHeaders);
  }
  if (password.length < 8) {
    return jsonError("Password must be at least 8 characters.", 400, corsHeaders);
  }
  if (profilePhoto && profilePhoto.length > 2_000_000) {
    return jsonError("That profile photo is too large. Try a smaller image.", 400, corsHeaders);
  }
  if (!contactConsent) {
    return jsonError("Please check the box agreeing to receive text messages and emails to continue.", 400, corsHeaders);
  }

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? OR username = ?")
    .bind(email, email)
    .first();
  if (existing) {
    return jsonError("An account already exists for that email.", 409, corsHeaders);
  }

  const { salt, hash } = await hashPassword(password);
  const isManagerTier = requestedRole === "regional_manager" || requestedRole === "operations_manager";

  if (isManagerTier) {
    if (!regionName) return jsonError("A region/team name is required.", 400, corsHeaders);
    const buildingAccess = requestedRole === "operations_manager" ? "all" : "own";
    await env.DB.prepare(
      `INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, building_access, region, email, phone, profile_photo, status, is_active, contact_consent, contact_consent_at)
       VALUES (?, ?, ?, ?, ?, 'regional_manager', ?, ?, ?, ?, ?, 'pending', 0, 1, CURRENT_TIMESTAMP)`,
    )
      .bind(email, hash, salt, fullName, JOB_TITLES[requestedRole], buildingAccess, regionName, email, phone || null, profilePhoto)
      .run();
    return jsonOk({ ok: true, message: "Your request has been sent to an administrator for approval." }, corsHeaders);
  }

  if (!buildingId) {
    return jsonError(
      "Please talk to your operations manager to register the building before you can create a profile.",
      404,
      corsHeaders,
    );
  }
  const building = await env.DB.prepare("SELECT id, region FROM buildings WHERE id = ?").bind(buildingId).first();
  if (!building) {
    return jsonError(
      "Please talk to your operations manager to register the building before you can create a profile.",
      404,
      corsHeaders,
    );
  }

  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, region, building_id, email, phone, profile_photo, status, is_active, contact_consent, contact_consent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 1, CURRENT_TIMESTAMP)`,
  )
    .bind(email, hash, salt, fullName, JOB_TITLES[requestedRole], requestedRole, building.region, building.id, email, phone || null, profilePhoto)
    .run();

  return jsonOk(
    { ok: true, message: "Your request has been sent to your operations manager for approval." },
    corsHeaders,
  );
}

function pendingRoleLabel(role, buildingAccess) {
  if (role === "regional_manager" && buildingAccess === "all") return "Operations Manager";
  return JOB_TITLES[role] || role;
}

// A Regional Manager sees pending Super/PM requests for buildings THEY
// registered. An Operations Manager (or Admin) sees pending requests for
// every building. Admin additionally sees pending Regional/Operations
// Manager requests -- there's no one else to approve those.
export async function handlePendingRequests(session, env, corsHeaders) {
  if (session.role === "admin") {
    const [managerRequests, buildingRequests] = await Promise.all([
      env.DB.prepare(
        `SELECT id, full_name, email, phone, role, building_access, profile_photo, region
         FROM users WHERE status = 'pending' AND role = 'regional_manager' ORDER BY id`,
      ).all(),
      env.DB.prepare(
        `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.building_access, u.profile_photo, b.name AS building_name
         FROM users u JOIN buildings b ON b.id = u.building_id
         WHERE u.status = 'pending' ORDER BY u.id`,
      ).all(),
    ]);
    const managers = managerRequests.results.map((r) => ({
      ...r,
      building_name: r.region,
      role_label: pendingRoleLabel(r.role, r.building_access),
    }));
    const buildings = buildingRequests.results.map((r) => ({ ...r, role_label: pendingRoleLabel(r.role, r.building_access) }));
    return jsonOk({ requests: [...managers, ...buildings] }, corsHeaders);
  }

  const scoped = canSeeAllBuildings(session);
  const result = await env.DB.prepare(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.building_access, u.profile_photo, b.name AS building_name
     FROM users u JOIN buildings b ON b.id = u.building_id
     WHERE u.status = 'pending' ${scoped ? "" : `AND ${ownedOrSharedSql("b")}`} ORDER BY u.id`,
  )
    .bind(...(scoped ? [] : [session.id, session.id]))
    .all();
  return jsonOk(
    { requests: result.results.map((r) => ({ ...r, role_label: pendingRoleLabel(r.role, r.building_access) })) },
    corsHeaders,
  );
}

export async function handlePendingRequestDecision(request, session, env, corsHeaders, approve) {
  const body = await request.json().catch(() => ({}));
  const userId = Number.parseInt(body.userId, 10);
  const scoped = canSeeAllBuildings(session);

  let pending;
  if (session.role === "admin") {
    pending = await env.DB.prepare(
      `SELECT id, role, building_id FROM users WHERE id = ? AND status = 'pending'
       AND (role = 'regional_manager' OR building_id IS NOT NULL)`,
    )
      .bind(userId)
      .first();
  } else if (scoped) {
    pending = await env.DB.prepare(
      `SELECT u.id FROM users u JOIN buildings b ON b.id = u.building_id WHERE u.id = ? AND u.status = 'pending'`,
    )
      .bind(userId)
      .first();
  } else {
    pending = await env.DB.prepare(
      `SELECT u.id FROM users u JOIN buildings b ON b.id = u.building_id
       WHERE u.id = ? AND u.status = 'pending' AND ${ownedOrSharedSql("b")}`,
    )
      .bind(userId, session.id, session.id)
      .first();
  }
  if (!pending) return jsonError("Request not found.", 404, corsHeaders);

  await env.DB.prepare("UPDATE users SET status = ?, is_active = ? WHERE id = ?")
    .bind(approve ? "active" : "denied", approve ? 1 : 0, userId)
    .run();

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
