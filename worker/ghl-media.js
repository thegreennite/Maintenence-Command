// GoHighLevel Media Library integration -- one company's photos, one
// company's own GHL sub-account, matching the per-company database
// isolation built elsewhere in this app (see worker/tenant-db.js):
// FHG Maintenance's inspection photos live in FHG's own GHL
// sub-account's media library, organized into one folder per ISO week
// of the inspection, never mixed with any other company's media.
//
// Live as of 2026-09-17 -- worker/photos.js's storePhoto() uses this
// whenever env.GHL_API_KEY/env.GHL_LOCATION_ID are configured (falls
// back to R2 otherwise, for a future company without its own sub-
// account yet). Confirmed against FHG's real sub-account: folder
// list/create uses altId+altType=location (not locationId, which GHL's
// API rejects with a 422).

const GHL_API = "https://services.leadconnectorhq.com";

// Per-company GHL credentials -- NOT env.GHL_API_KEY/env.GHL_LOCATION_ID
// (that pair is Revinetic's own account, reused only for 2FA emails).
// Passed in explicitly rather than read off `env` directly so this is
// ready for the eventual per-client credential lookup (a `ghl_location_id`
// / `ghl_api_key` pair on the control-plane clients table, mirroring
// `database_id` -- not built yet, since only FHG has a real sub-account
// to test against so far).
// A single photo capture in command mode is a one-shot moment for
// whoever's standing in front of the machine -- worth one automatic
// retry on exactly the errors that are transient (a rate limit, or GHL
// itself hiccuping) rather than surfacing "it didn't work" for
// something a half-second retry would have quietly absorbed. Never
// retries a real rejection (bad request, auth failure, etc.).
async function ghlMediaFetch(creds, path, options = {}, attempt = 1) {
  const response = await fetch(`${GHL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${creds.apiKey}`,
      Version: "2021-07-28",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const transient = response.status === 429 || response.status >= 500;
    if (transient && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      return ghlMediaFetch(creds, path, options, attempt + 1);
    }
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

// In-memory first (free, instant, lives as long as this isolate stays
// warm), D1 second (survives isolate recycling -- a folder's id never
// changes once created, so once any isolate has ever resolved it, every
// later request anywhere should find it in one indexed lookup instead
// of paying GHL's list-then-maybe-create round trip again).
const folderIdCache = new Map();

async function ensureFolder(creds, name, parentId, env) {
  const cacheKey = `${creds.locationId}/${parentId || "root"}/${name}`;
  if (folderIdCache.has(cacheKey)) return folderIdCache.get(cacheKey);

  // Best-effort only -- this is purely a speed optimization (see the
  // comment above folderIdCache). A D1 hiccup here must never be able
  // to fail a photo upload that GHL's own list/create would otherwise
  // have handled fine; falling through to that is always safe, just
  // slightly slower this one time.
  try {
    const cached = await env.DB.prepare("SELECT folder_id FROM ghl_folder_cache WHERE cache_key = ?").bind(cacheKey).first();
    if (cached) {
      folderIdCache.set(cacheKey, cached.folder_id);
      return cached.folder_id;
    }
  } catch (error) {
    console.error("ghl_folder_cache read failed, falling through to GHL", error);
  }

  const listParams = new URLSearchParams({ altId: creds.locationId, altType: "location", type: "folder" });
  if (parentId) listParams.set("parentId", parentId);
  const listed = await ghlMediaFetch(creds, `/medias/files?${listParams}`);
  const existing = (listed.files || listed.medias || []).find((f) => f.name === name);

  // GHL's media/folder documents are MongoDB-backed -- the real
  // identifier field is `_id`, confirmed against a live create response
  // (`id`/`folder.id`, guessed before that was confirmed, were both
  // silently undefined -- meaning every freshly-created folder was
  // uploading its photos to the media library's root instead of the
  // intended building/week folder until this was caught).
  let folderId;
  if (existing) {
    folderId = existing._id || existing.id;
  } else {
    const created = await ghlMediaFetch(creds, "/medias/folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ altId: creds.locationId, altType: "location", name, parentId: parentId || undefined }),
    });
    folderId = created._id || created.id || created.folder?._id || created.folder?.id;
    if (!folderId) throw new Error(`GHL folder create returned no id: ${JSON.stringify(created)}`);
  }

  folderIdCache.set(cacheKey, folderId);
  // Also best-effort -- the folder is already real and usable (we just
  // resolved it above) even if this particular write never lands.
  try {
    await env.DB.prepare("INSERT INTO ghl_folder_cache (cache_key, folder_id) VALUES (?, ?) ON CONFLICT (cache_key) DO NOTHING")
      .bind(cacheKey, folderId)
      .run();
  } catch (error) {
    console.error("ghl_folder_cache write failed, continuing anyway", error);
  }
  return folderId;
}

// Uploads one photo into <buildingName>/<ISO week> in FHG's GHL media
// library. `imageBase64` is the same client-compressed JPEG payload
// worker/photos.js's storePhoto() already receives -- decoded here into
// raw bytes for the multipart upload. Returns the GHL file's id + url.
export async function uploadInspectionPhotoToGhl(creds, { imageBase64, mediaType, buildingName, inspectionDateIso, fileName }, env) {
  const buildingFolderId = await ensureFolder(creds, buildingName, null, env);
  const weekFolderId = await ensureFolder(creds, isoWeekFolderName(inspectionDateIso), buildingFolderId, env);

  const binary = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("file", new Blob([binary], { type: mediaType }), fileName);
  form.append("altId", creds.locationId);
  form.append("altType", "location");
  form.append("parentId", weekFolderId);

  const uploaded = await ghlMediaFetch(creds, "/medias/upload-file", { method: "POST", body: form });
  return { fileId: uploaded.id || uploaded.fileId, url: uploaded.url };
}
