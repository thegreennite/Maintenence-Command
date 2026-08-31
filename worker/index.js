import {
  clearSessionCookie,
  createSessionToken,
  hashToken,
  readCookie,
  sessionCookie,
  verifyPassword,
} from "./security.js";
import { dashboardForRole, roleLabels } from "./dashboard-data.js";
import { handleInspectionToday, handleInspectionSave, handleInspectionSubmit } from "./inspections.js";
import { handleManagerInspection, handleManagerParametersSave, handleManagerSuperintendents } from "./manager.js";
import { handlePropertyInspections } from "./property.js";
import { handleInspectionPhoto } from "./vision.js";
import {
  handleBuildingsList,
  handleBuildingCreate,
  handlePushLive,
  handleUnassignedSuperintendents,
  handleAssignSuperintendent,
  handleGenerateTags,
  handleSaveTags,
} from "./buildings.js";
import { handleGeocodeSearch } from "./geocode.js";
import { handleFlagIssue, handleManagerWorkOrders, handleResolveWorkOrder } from "./work-orders.js";
import { handleAdminStats } from "./admin-stats.js";
import {
  handleBuildingSearchForRegistration,
  handleSelfRegister,
  handlePendingRequests,
  handlePendingRequestDecision,
} from "./registration.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "fhg-command-api" }, 200, cors.headers);
    }

    if (!url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404, cors.headers);
    }

    if (!cors.allowed) {
      return json({ error: "Origin not allowed" }, 403, cors.headers);
    }

    try {
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        return handleLogin(request, env, cors.headers);
      }

      // Public: no session required — someone filling out the sign-up form
      // doesn't have one yet.
      if (url.pathname === "/api/register/buildings/search" && request.method === "GET") {
        return handleBuildingSearchForRegistration(request, env, cors.headers);
      }
      if (url.pathname === "/api/register" && request.method === "POST") {
        return handleSelfRegister(request, env, cors.headers);
      }
      if (url.pathname === "/api/geocode/search" && request.method === "GET") {
        return handleGeocodeSearch(request, env, cors.headers);
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        return handleLogout(request, env, cors.headers);
      }

      const session = await requireSession(request, env);
      if (!session) return json({ error: "Authentication required" }, 401, cors.headers);

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        return json(sessionPayload(session), 200, cors.headers);
      }

      if (url.pathname === "/api/dashboard" && request.method === "GET") {
        return json({ dashboard: dashboardForRole(session.role, session.full_name) }, 200, cors.headers);
      }

      if (url.pathname === "/api/admin/accounts" && request.method === "GET") {
        return handleAccounts(session, env, cors.headers);
      }

      if (url.pathname === "/api/admin/stats" && request.method === "GET") {
        if (session.role !== "admin") {
          return json({ error: "Administrator access required" }, 403, cors.headers);
        }
        return handleAdminStats(env, cors.headers);
      }

      if (url.pathname === "/api/admin/impersonate" && request.method === "POST") {
        return handleImpersonate(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/admin/return" && request.method === "POST") {
        return handleAdminReturn(session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/today" && request.method === "GET") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleInspectionToday(session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/save" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleInspectionSave(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/submit" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleInspectionSubmit(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/flag-issue" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleFlagIssue(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/work-orders" && request.method === "GET") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleManagerWorkOrders(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/work-orders/resolve" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleResolveWorkOrder(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/inspections/photo" && request.method === "POST") {
        if (session.role !== "superintendent") {
          return json({ error: "Superintendent access required" }, 403, cors.headers);
        }
        return handleInspectionPhoto(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/inspection" && request.method === "GET") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleManagerInspection(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/parameters" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleManagerParametersSave(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings" && request.method === "GET") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleBuildingsList(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleBuildingCreate(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/superintendents/unassigned" && request.method === "GET") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleUnassignedSuperintendents(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/assign" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleAssignSuperintendent(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/tags/generate" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleGenerateTags(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/tags/save" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleSaveTags(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/buildings/push-live" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handlePushLive(request, session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/superintendents" && request.method === "GET") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handleManagerSuperintendents(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/pending-requests" && request.method === "GET") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handlePendingRequests(session, env, cors.headers);
      }

      if (url.pathname === "/api/manager/pending-requests/approve" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handlePendingRequestDecision(request, session, env, cors.headers, true);
      }

      if (url.pathname === "/api/manager/pending-requests/deny" && request.method === "POST") {
        if (session.role !== "regional_manager") {
          return json({ error: "Regional Operations Manager access required" }, 403, cors.headers);
        }
        return handlePendingRequestDecision(request, session, env, cors.headers, false);
      }

      if (url.pathname === "/api/property/inspections" && request.method === "GET") {
        if (session.role !== "property_manager") {
          return json({ error: "Property Manager access required" }, 403, cors.headers);
        }
        return handlePropertyInspections(request, session, env, cors.headers);
      }

      return json({ error: "Not found" }, 404, cors.headers);
    } catch (error) {
      console.error("Request failed", error);
      return json({ error: "Something went wrong" }, 500, cors.headers);
    }
  },
};

async function handleLogin(request, env, corsHeaders) {
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) {
    return json({ error: "Username and password are required" }, 400, corsHeaders);
  }

  // Look up by username regardless of is_active — a pending/denied account
  // still needs to verify its password before we say anything about status,
  // so a wrong-password guess against a real email doesn't confirm it exists.
  const user = await env.DB.prepare(
    `SELECT id, username, password_hash, password_salt, full_name, job_title, role, region, status
     FROM users WHERE username = ?`,
  )
    .bind(username)
    .first();

  const valid = user
    ? await verifyPassword(password, user.password_salt, user.password_hash)
    : false;

  if (!valid) return json({ error: "Invalid username or password" }, 401, corsHeaders);

  if (user.status === "pending") {
    return json({ error: "Your account is still pending approval from your operations manager." }, 403, corsHeaders);
  }
  if (user.status === "denied") {
    return json({ error: "Your registration request was not approved. Contact your operations manager." }, 403, corsHeaders);
  }

  const token = createSessionToken();
  const tokenHash = await hashToken(token);
  const ttlHours = Math.max(1, Number.parseInt(env.SESSION_TTL_HOURS || "12", 10));
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(new Date().toISOString()),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, actor_user_id, expires_at) VALUES (?, ?, ?, ?)",
    ).bind(tokenHash, user.id, user.id, expiresAt),
  ]);

  const headers = new Headers(corsHeaders);
  headers.set("Set-Cookie", sessionCookie(request, token, ttlHours * 60 * 60));
  return json(
    {
      user: publicUser(user),
      actor: publicUser(user),
      isImpersonating: false,
    },
    200,
    headers,
  );
}

async function handleLogout(request, env, corsHeaders) {
  const token = readCookie(request, "fhg_session");
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await hashToken(token))
      .run();
  }
  const headers = new Headers(corsHeaders);
  headers.set("Set-Cookie", clearSessionCookie(request));
  return json({ ok: true }, 200, headers);
}

async function handleAccounts(session, env, corsHeaders) {
  if (session.actor_role !== "admin") {
    return json({ error: "Administrator access required" }, 403, corsHeaders);
  }

  const result = await env.DB.prepare(
    `SELECT id, username, full_name, job_title, role, region
     FROM users WHERE is_active = 1 AND role != 'admin'
     ORDER BY CASE role
       WHEN 'regional_manager' THEN 1
       WHEN 'superintendent' THEN 2
       ELSE 3 END, full_name`,
  ).all();

  return json({ accounts: result.results.map(publicUser) }, 200, corsHeaders);
}

async function handleImpersonate(request, session, env, corsHeaders) {
  // Admin can switch into any account. A Regional Manager can only switch
  // into a Superintendent within their own region — not another manager,
  // not a Property Manager, not anyone outside the buildings they oversee.
  const isAdmin = session.actor_role === "admin";
  const isManager = session.actor_role === "regional_manager";
  if (!isAdmin && !isManager) {
    return json({ error: "Not permitted" }, 403, corsHeaders);
  }

  const body = await readJson(request);
  const userId = Number.parseInt(body.userId, 10);

  const target = isAdmin
    ? await env.DB.prepare(
        `SELECT id, username, full_name, job_title, role, region
         FROM users WHERE id = ? AND is_active = 1 AND role != 'admin'`,
      )
        .bind(userId)
        .first()
    : await env.DB.prepare(
        `SELECT id, username, full_name, job_title, role, region
         FROM users WHERE id = ? AND is_active = 1 AND role = 'superintendent' AND region = ?`,
      )
        .bind(userId, session.actor_region)
        .first();

  if (!target) return json({ error: "Account not found" }, 404, corsHeaders);

  await env.DB.prepare("UPDATE sessions SET user_id = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(target.id, session.session_id)
    .run();

  return json(
    {
      user: publicUser(target),
      actor: actorUser(session),
      isImpersonating: true,
    },
    200,
    corsHeaders,
  );
}

async function handleAdminReturn(session, env, corsHeaders) {
  if (session.actor_role !== "admin" && session.actor_role !== "regional_manager") {
    return json({ error: "Not permitted" }, 403, corsHeaders);
  }

  await env.DB.prepare("UPDATE sessions SET user_id = actor_user_id, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(session.session_id)
    .run();

  const actor = actorUser(session);
  return json({ user: actor, actor, isImpersonating: false }, 200, corsHeaders);
}

async function requireSession(request, env) {
  const token = readCookie(request, "fhg_session");
  if (!token) return null;

  const session = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
       u.id, u.username, u.full_name, u.job_title, u.role, u.region, u.building_id,
       actor.id AS actor_id, actor.username AS actor_username,
       actor.full_name AS actor_full_name, actor.job_title AS actor_job_title,
       actor.role AS actor_role, actor.region AS actor_region
     FROM sessions s
     JOIN users u ON u.id = s.user_id AND u.is_active = 1
     JOIN users actor ON actor.id = s.actor_user_id AND actor.is_active = 1
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await hashToken(token), new Date().toISOString())
    .first();

  // Inactivity timeout: even within the absolute session lifetime, an hour
  // with no requests locks the account out and requires signing back in.
  const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
  if (session) {
    const idleMs = Date.now() - new Date(session.last_seen_at + "Z").getTime();
    if (idleMs > INACTIVITY_LIMIT_MS) {
      await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(session.session_id).run();
      return null;
    }
  }

  if (session) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(session.session_id)
      .run();
  }
  return session;
}

function sessionPayload(session) {
  return {
    user: publicUser(session),
    actor: actorUser(session),
    isImpersonating: session.id !== session.actor_id,
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    jobTitle: user.job_title,
    role: user.role,
    roleLabel: roleLabels[user.role],
    region: user.region,
  };
}

function actorUser(session) {
  return publicUser({
    id: session.actor_id,
    username: session.actor_username,
    full_name: session.actor_full_name,
    job_title: session.actor_job_title,
    role: session.actor_role,
    region: session.actor_region,
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = !origin || allowedOrigins.includes(origin);
  const headers = new Headers({
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    Vary: "Origin",
  });
  if (origin && allowed) headers.set("Access-Control-Allow-Origin", origin);
  return { allowed, headers };
}

async function readJson(request) {
  if (!request.headers.get("Content-Type")?.includes("application/json")) return {};
  return request.json();
}

function json(data, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  for (const [key, value] of Object.entries(JSON_HEADERS)) responseHeaders.set(key, value);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}
