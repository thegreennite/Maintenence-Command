// Photo library -- every photo used for an AI reading (inspection
// capture or a building-sheet checklist upload) or a compliance proof
// photo gets tracked here too, organized building/date, so a
// superintendent or regional manager can look back at what a gauge
// actually looked like on a given day.
//
// Where the bytes actually live depends on the company: when GHL Media
// Library credentials are configured (currently FHG's own sub-account,
// via env.GHL_API_KEY/env.GHL_LOCATION_ID) that's the real store, kept
// organized as <building>/<ISO week> there too -- see
// worker/ghl-media.js. Falls back to R2 when no GHL credentials are
// configured (future companies without their own sub-account yet). The
// `photos` D1 table (migrations/0020_photos_index.sql) is what actually
// makes listing/viewing backend-agnostic -- every storePhoto() call
// records one row here regardless of which backend it used, and legacy
// R2 objects from before this table existed were backfilled into it
// once (see scripts/backfill-photos-index.mjs) rather than needing to
// physically move.

import { canSeeAllBuildings, ownedOrSharedSql, effectiveClientId, clientScopeSql } from "./access.js";

function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" }); // en-CA = YYYY-MM-DD
}

const EXTENSIONS_BY_MEDIA_TYPE = {
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function ghlConfigured(env) {
  return Boolean(env.GHL_API_KEY && env.GHL_LOCATION_ID);
}

export async function storePhoto(env, { buildingId, imageBase64, mediaType, context, uploadedBy }) {
  const date = todayIso();
  const ext = EXTENSIONS_BY_MEDIA_TYPE[mediaType] || "jpg";
  const rand = crypto.randomUUID().slice(0, 8);

  let backend, location;
  if (ghlConfigured(env)) {
    const { uploadInspectionPhotoToGhl } = await import("./ghl-media.js");
    const building = await env.DB.prepare("SELECT name FROM buildings WHERE id = ?").bind(buildingId).first();
    const fileName = `${date}-${context}-${rand}.${ext}`;
    const result = await uploadInspectionPhotoToGhl(
      { apiKey: env.GHL_API_KEY, locationId: env.GHL_LOCATION_ID },
      { imageBase64, mediaType, buildingName: building?.name || `building-${buildingId}`, inspectionDateIso: date, fileName },
      env,
    );
    backend = "ghl";
    location = result.url;
  } else if (env.PHOTOS) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `${buildingId}/${date}/${stamp}-${rand}-${context}.${ext}`;
    const binary = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    await env.PHOTOS.put(key, binary, {
      httpMetadata: { contentType: mediaType },
      customMetadata: { context, uploadedBy: String(uploadedBy || "") },
    });
    backend = "r2";
    location = key;
  } else {
    return null;
  }

  await env.DB.prepare(
    "INSERT INTO photos (building_id, date, context, backend, location, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(buildingId, date, context, backend, location, uploadedBy || null)
    .run();

  return location;
}

async function resolveAllowedBuildingIds(session, env, requestedBuildingId) {
  if (session.role === "superintendent") {
    return session.building_id === requestedBuildingId ? [requestedBuildingId] : [];
  }
  if (session.role === "regional_manager" || session.role === "admin") {
    const clientId = effectiveClientId(session);
    const row = canSeeAllBuildings(session)
      ? await env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL AND ${clientScopeSql("buildings")}`)
          .bind(requestedBuildingId, clientId)
          .first()
      : await env.DB.prepare(`SELECT id FROM buildings WHERE id = ? AND deleted_at IS NULL AND ${clientScopeSql("buildings")} AND ${ownedOrSharedSql("buildings")}`)
          .bind(requestedBuildingId, clientId, session.id, session.id)
          .first();
    return row ? [requestedBuildingId] : [];
  }
  return [];
}

export async function handlePhotoDates(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  const allowed = await resolveAllowedBuildingIds(session, env, buildingId);
  if (!allowed.length) return jsonError("Not found.", 404, corsHeaders);

  const result = await env.DB.prepare("SELECT DISTINCT date FROM photos WHERE building_id = ? ORDER BY date DESC")
    .bind(buildingId)
    .all();
  return jsonOk({ dates: result.results.map((r) => r.date) }, corsHeaders);
}

export async function handlePhotoList(request, session, env, corsHeaders) {
  const url = new URL(request.url);
  const buildingId = Number.parseInt(url.searchParams.get("buildingId"), 10);
  const date = url.searchParams.get("date");
  const allowed = await resolveAllowedBuildingIds(session, env, buildingId);
  if (!allowed.length || !date) return jsonError("Not found.", 404, corsHeaders);

  const result = await env.DB.prepare(
    "SELECT location, context, created_at FROM photos WHERE building_id = ? AND date = ? ORDER BY created_at DESC",
  )
    .bind(buildingId, date)
    .all();
  const photos = result.results.map((r) => ({ key: r.location, uploadedAt: r.created_at, context: r.context }));
  return jsonOk({ photos }, corsHeaders);
}

export async function handlePhotoView(request, session, env, corsHeaders) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  // A GHL-backed photo's "key" is the full https:// URL it was uploaded
  // to -- can't parse a buildingId out of that the way an R2 key's
  // `${buildingId}/...` prefix allows, so it's passed explicitly.
  const isGhlUrl = key.startsWith("https://");
  const buildingId = isGhlUrl
    ? Number.parseInt(url.searchParams.get("buildingId"), 10)
    : Number.parseInt(key.split("/")[0], 10);
  const allowed = await resolveAllowedBuildingIds(session, env, buildingId);
  if (!allowed.length) return new Response("Not found", { status: 404 });

  if (isGhlUrl) {
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: key } });
  }

  if (!env.PHOTOS) return new Response("Not found", { status: 404 });
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
