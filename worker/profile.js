// Every account can edit its own display name and "Written Role" -- the
// job_title field, which is deliberately separate from the system `role`
// (permissions) so someone's badge can say what they actually do (e.g.
// "Field Inventory Operations Specialist") rather than just their access
// tier (Operations Manager).

export async function handleUpdateProfile(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const fullName = String(body.fullName || "").trim();
  const jobTitle = String(body.jobTitle || "").trim();

  if (!fullName) return jsonError("A name is required.", 400, corsHeaders);
  if (!jobTitle) return jsonError("A written role is required.", 400, corsHeaders);
  if (jobTitle.length > 80) return jsonError("Keep the written role under 80 characters.", 400, corsHeaders);

  await env.DB.prepare("UPDATE users SET full_name = ?, job_title = ? WHERE id = ?")
    .bind(fullName, jobTitle, session.id)
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
