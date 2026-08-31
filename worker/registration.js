// Self-registration: a Superintendent or Property Manager signs themselves
// up against a building that already exists, and lands in "pending" status
// until the building's Regional Manager approves them. No public sign-up
// exists for Regional Manager or Admin — those stay provisioned by hand.

import { hashPassword } from "./security.js";

const SELF_SERVE_ROLES = new Set(["superintendent", "property_manager"]);
const JOB_TITLES = { superintendent: "Superintendent", property_manager: "Property Manager" };

export async function handleBuildingSearchForRegistration(request, env, corsHeaders) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return jsonOk({ buildings: [] }, corsHeaders);

  const result = await env.DB.prepare(
    `SELECT id, name, address FROM buildings WHERE name LIKE ? ORDER BY name LIMIT 10`,
  )
    .bind(`%${q}%`)
    .all();
  return jsonOk({ buildings: result.results }, corsHeaders);
}

export async function handleSelfRegister(request, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const role = String(body.role || "");
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim();
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");
  const buildingId = Number.parseInt(body.buildingId, 10);
  const profilePhoto = typeof body.profilePhoto === "string" ? body.profilePhoto : null;

  if (!SELF_SERVE_ROLES.has(role)) {
    return jsonError("Choose whether you're registering as a Superintendent or Property Manager.", 400, corsHeaders);
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

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? OR username = ?")
    .bind(email, email)
    .first();
  if (existing) {
    return jsonError("An account already exists for that email.", 409, corsHeaders);
  }

  const { salt, hash } = await hashPassword(password);

  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, password_salt, full_name, job_title, role, region, building_id, email, phone, profile_photo, status, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
  )
    .bind(email, hash, salt, fullName, JOB_TITLES[role], role, building.region, building.id, email, phone || null, profilePhoto)
    .run();

  return jsonOk(
    { ok: true, message: "Your request has been sent to your operations manager for approval." },
    corsHeaders,
  );
}

export async function handlePendingRequests(session, env, corsHeaders) {
  const result = await env.DB.prepare(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.profile_photo, b.name AS building_name
     FROM users u JOIN buildings b ON b.id = u.building_id
     WHERE u.status = 'pending' AND b.region = ? ORDER BY u.id`,
  )
    .bind(session.region)
    .all();
  return jsonOk({ requests: result.results }, corsHeaders);
}

export async function handlePendingRequestDecision(request, session, env, corsHeaders, approve) {
  const body = await request.json().catch(() => ({}));
  const userId = Number.parseInt(body.userId, 10);

  const pending = await env.DB.prepare(
    `SELECT u.id FROM users u JOIN buildings b ON b.id = u.building_id
     WHERE u.id = ? AND u.status = 'pending' AND b.region = ?`,
  )
    .bind(userId, session.region)
    .first();
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
