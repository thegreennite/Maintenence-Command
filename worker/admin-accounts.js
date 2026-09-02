// Admin-only account management: "get rid of" a profile (soft-delete --
// blocks login and disappears from every list, but existing inspection
// history still shows their name, same non-destructive philosophy as
// building deletion) and classify one (a free-form-ish label, used right
// now to gate the AI photo-reading feature to just the beta tester --
// see CLASSIFICATIONS below and its use in worker/vision.js).

export const CLASSIFICATIONS = {
  standard: "Standard",
  beta_tester: "Beta Tester",
};

function requireAdmin(session, corsHeaders) {
  if (session.role !== "admin") {
    return jsonError("Administrator access required.", 403, corsHeaders);
  }
  return null;
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
     FROM users WHERE removed_at IS NOT NULL ORDER BY removed_at DESC`,
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
