// The mandatory proof-of-presence photo per equipment group -- plain
// storage only, no AI reading. The browser sends the original camera file
// as multipart binary; capture time and geolocation are stored alongside it
// in D1. Avoiding canvas/image decoding prevents Android Chrome bitmap OOM.

import { ensureSubmission } from "./inspections.js";
import { storePhoto } from "./photos.js";

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Past this distance from the building's own registered address, a
// compliance photo's GPS position gets flagged as a heads-up -- wide
// enough to absorb normal GPS drift and a large property/parking lot,
// tight enough to catch "this photo wasn't actually taken here."
const LOCATION_MISMATCH_THRESHOLD_M = 500;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6_371_000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function handleGroupPhotoUpload(request, session, env, corsHeaders) {
  const body = await request.formData().catch(() => null);
  const groupId = Number.parseInt(body?.get("groupId"), 10);
  const imageBlob = body?.get("photo");
  const mediaType = imageBlob?.type || "";
  const capturedAt = String(body?.get("capturedAt") || new Date().toISOString());
  const latitudeValue = body?.has("latitude") ? Number(body.get("latitude")) : NaN;
  const longitudeValue = body?.has("longitude") ? Number(body.get("longitude")) : NaN;
  const latitude = Number.isFinite(latitudeValue) ? latitudeValue : null;
  const longitude = Number.isFinite(longitudeValue) ? longitudeValue : null;

  if (!groupId || !imageBlob || typeof imageBlob.arrayBuffer !== "function") {
    return jsonError("A photo and a machine are required.", 400, corsHeaders);
  }
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return jsonError("Unsupported image type — use JPEG, PNG, or WEBP.", 400, corsHeaders);
  }
  if (imageBlob.size > 20_000_000) {
    return jsonError("That photo is too large. Try again.", 400, corsHeaders);
  }

  let submissionId, buildingId;
  try {
    ({ submissionId, buildingId } = await ensureSubmission(session, env));
  } catch (error) {
    if (error.status) return jsonError(error.message, error.status, corsHeaders);
    throw error;
  }

  const group = await env.DB.prepare("SELECT id, name FROM equipment_groups WHERE id = ? AND building_id = ?")
    .bind(groupId, buildingId)
    .first();
  if (!group) return jsonError("That machine wasn't found on this building's checklist.", 404, corsHeaders);

  const photoKey = await storePhoto(env, {
    buildingId,
    imageBlob,
    mediaType,
    context: `group-${groupId}`,
    uploadedBy: session.id,
  });
  if (!photoKey) return jsonError("Photo storage isn't configured on this deployment.", 503, corsHeaders);

  let distanceFromBuildingM = null;
  if (latitude != null && longitude != null) {
    const building = await env.DB.prepare("SELECT latitude, longitude FROM buildings WHERE id = ?").bind(buildingId).first();
    if (building?.latitude != null && building?.longitude != null) {
      distanceFromBuildingM = Math.round(haversineMeters(latitude, longitude, building.latitude, building.longitude));
    }
  }
  const locationMismatch = distanceFromBuildingM != null && distanceFromBuildingM > LOCATION_MISMATCH_THRESHOLD_M;

  await env.DB.prepare(
    `INSERT INTO group_photos (submission_id, equipment_group_id, photo_key, captured_at, latitude, longitude, distance_from_building_m)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (submission_id, equipment_group_id)
     DO UPDATE SET photo_key = excluded.photo_key, captured_at = excluded.captured_at,
       latitude = excluded.latitude, longitude = excluded.longitude, distance_from_building_m = excluded.distance_from_building_m`,
  )
    .bind(submissionId, groupId, photoKey, capturedAt, latitude, longitude, distanceFromBuildingM)
    .run();

  return jsonOk(
    { ok: true, groupId, photoKey, capturedAt, latitude, longitude, distanceFromBuildingM, locationMismatch },
    corsHeaders,
  );
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
