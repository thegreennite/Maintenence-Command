// R2-backed photo library. Every photo used for an AI reading (inspection
// capture or a building-sheet checklist upload) gets kept here too --
// organized building/date, so a superintendent or regional manager can
// look back at what a gauge actually looked like on a given day.

function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); // en-CA = YYYY-MM-DD
}

export async function storePhoto(env, { buildingId, imageBase64, mediaType, context, uploadedBy }) {
  if (!env.PHOTOS) return null;
  const ext = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
  const date = todayIso();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomUUID().slice(0, 8);
  const key = `${buildingId}/${date}/${stamp}-${rand}-${context}.${ext}`;

  const binary = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  await env.PHOTOS.put(key, binary, {
    httpMetadata: { contentType: mediaType },
    customMetadata: { context, uploadedBy: String(uploadedBy || "") },
  });
  return key;
}

async function resolveAllowedBuildingIds(session, env, requestedBuildingId) {
  if (session.role === "superintendent") {
    return session.building_id === requestedBuildingId ? [requestedBuildingId] : [];
  }
  if (session.role === "regional_manager" || session.role === "admin") {
    const row = await env.DB.prepare("SELECT id FROM buildings WHERE id = ? AND (region = ? OR ? = 'admin')")
      .bind(requestedBuildingId, session.region, session.role)
      .first();
    return row ? [requestedBuildingId] : [];
  }
  return [];
}

export async function handlePhotoDates(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  const allowed = await resolveAllowedBuildingIds(session, env, buildingId);
  if (!allowed.length) return jsonError("Not found.", 404, corsHeaders);

  const listed = await env.PHOTOS.list({ prefix: `${buildingId}/`, delimiter: "/" });
  const dates = (listed.delimitedPrefixes || [])
    .map((prefix) => prefix.slice(`${buildingId}/`.length).replace(/\/$/, ""))
    .sort()
    .reverse();
  return jsonOk({ dates }, corsHeaders);
}

export async function handlePhotoList(request, session, env, corsHeaders) {
  const url = new URL(request.url);
  const buildingId = Number.parseInt(url.searchParams.get("buildingId"), 10);
  const date = url.searchParams.get("date");
  const allowed = await resolveAllowedBuildingIds(session, env, buildingId);
  if (!allowed.length || !date) return jsonError("Not found.", 404, corsHeaders);

  const listed = await env.PHOTOS.list({ prefix: `${buildingId}/${date}/` });
  const photos = (listed.objects || [])
    .map((obj) => ({ key: obj.key, uploadedAt: obj.uploaded, size: obj.size, context: obj.customMetadata?.context }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return jsonOk({ photos }, corsHeaders);
}

export async function handlePhotoView(request, session, env, corsHeaders) {
  const key = new URL(request.url).searchParams.get("key") || "";
  const buildingId = Number.parseInt(key.split("/")[0], 10);
  const allowed = await resolveAllowedBuildingIds(session, env, buildingId);
  if (!allowed.length) return new Response("Not found", { status: 404 });

  const object = await env.PHOTOS.get(key);
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(object.body, { headers });
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
