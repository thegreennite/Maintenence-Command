// GoHighLevel Media Library integration -- one company's photos, one
// company's own GHL sub-account, matching the per-company database
// isolation built elsewhere in this app (see worker/tenant-db.js):
// FHG Maintenance's inspection photos live in FHG's own GHL
// sub-account's media library, organized into one folder per ISO week
// of the inspection, never mixed with any other company's media.
//
// NOT YET WIRED IN as the live photo store -- worker/photos.js's
// storePhoto() still writes to R2. This module needs to be exercised
// against the real FHG Maintenance sub-account first (folder-lookup and
// upload request shapes below are built from GHL's documented API
// surface, not yet confirmed against a live response) before anything
// switches over.

const GHL_API = "https://services.leadconnectorhq.com";

// Per-company GHL credentials -- NOT env.GHL_API_KEY/env.GHL_LOCATION_ID
// (that pair is Revinetic's own account, reused only for 2FA emails).
// Passed in explicitly rather than read off `env` directly so this is
// ready for the eventual per-client credential lookup (a `ghl_location_id`
// / `ghl_api_key` pair on the control-plane clients table, mirroring
// `database_id` -- not built yet, since only FHG has a real sub-account
// to test against so far).
async function ghlMediaFetch(creds, path, options = {}) {
  const response = await fetch(`${GHL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      Version: "2021-07-28",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GHL Media API error (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

// ISO week label ("2026-W38") for the inspection date -- one folder per
// week, so today's photos and next week's never share a folder.
export function isoWeekFolderName(dateIso) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  const target = new Date(date.getTime());
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target - yearStart) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const folderIdCache = new Map();

// Find-or-create the week's folder in the Media Library -- GHL's folders
// are just media-library entries of type "folder" scoped by parentId, so
// this lists what's under `parentId` (a building-named parent folder,
// itself find-or-created the same way) filtering by name, creating one
// if none matches. Cached per Worker instance (folders don't change
// often); TODO verify this list/create shape against the real API --
// the exact request/response fields here are the ones GHL's docs
// describe, not yet confirmed live.
async function ensureFolder(creds, name, parentId = null) {
  const cacheKey = `${parentId || "root"}/${name}`;
  if (folderIdCache.has(cacheKey)) return folderIdCache.get(cacheKey);

  const listParams = new URLSearchParams({ locationId: creds.locationId, type: "folder" });
  if (parentId) listParams.set("parentId", parentId);
  const listed = await ghlMediaFetch(creds, `/medias/files?${listParams}`);
  const existing = (listed.files || listed.medias || []).find((f) => f.name === name);
  if (existing) {
    folderIdCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await ghlMediaFetch(creds, "/medias/folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locationId: creds.locationId, name, parentId: parentId || undefined }),
  });
  const folderId = created.id || created.folder?.id;
  folderIdCache.set(cacheKey, folderId);
  return folderId;
}

// Uploads one photo into <buildingName>/<ISO week> in FHG's GHL media
// library. `imageBase64` is the same client-compressed JPEG payload
// worker/photos.js's storePhoto() already receives -- decoded here into
// raw bytes for the multipart upload. Returns the GHL file's id + url.
export async function uploadInspectionPhotoToGhl(creds, { imageBase64, mediaType, buildingName, inspectionDateIso, fileName }) {
  const buildingFolderId = await ensureFolder(creds, buildingName);
  const weekFolderId = await ensureFolder(creds, isoWeekFolderName(inspectionDateIso), buildingFolderId);

  const binary = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("file", new Blob([binary], { type: mediaType }), fileName);
  form.append("locationId", creds.locationId);
  form.append("parentId", weekFolderId);

  const uploaded = await ghlMediaFetch(creds, "/medias/upload-file", { method: "POST", body: form });
  return { fileId: uploaded.id || uploaded.fileId, url: uploaded.url };
}
