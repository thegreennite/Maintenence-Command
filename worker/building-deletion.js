// Admin-only building deletion workflow: a Regional/Operations Manager can
// only request a building be deleted (see handleDeleteBuilding in
// buildings.js); an Administrator reviews the request and either approves
// it (soft-delete -- deleted_at is set, the building disappears from every
// normal view, but nothing is actually destroyed) or denies it (the
// building goes back to normal, untouched the whole time). A soft-deleted
// building's full record -- readings, tags, work orders, everything -- is
// kept for RETENTION_DAYS in case it needs to be restored, then
// purgeExpiredBuildings() below (called daily from worker/index.js's
// scheduled() handler) permanently deletes it for good.

const RETENTION_DAYS = 30;

export async function handleDeleteRequestsList(session, env, corsHeaders) {
  if (session.role !== "admin") return jsonError("Administrator access required.", 403, corsHeaders);
  const result = await env.DB.prepare(
    `SELECT b.id, b.name, b.address, b.region, b.delete_requested_at, u.full_name AS requested_by_name
     FROM buildings b LEFT JOIN users u ON u.id = b.delete_requested_by
     WHERE b.delete_requested_at IS NOT NULL AND b.deleted_at IS NULL
     ORDER BY b.delete_requested_at DESC`,
  ).all();
  return jsonOk({ requests: result.results }, corsHeaders);
}

export async function handleApproveDeleteRequest(request, session, env, corsHeaders) {
  if (session.role !== "admin") return jsonError("Administrator access required.", 403, corsHeaders);
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const building = await env.DB.prepare(
    "SELECT id FROM buildings WHERE id = ? AND delete_requested_at IS NOT NULL AND deleted_at IS NULL",
  )
    .bind(buildingId)
    .first();
  if (!building) return jsonError("There's no pending delete request for that building.", 404, corsHeaders);

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE buildings SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, delete_requested_at = NULL, delete_requested_by = NULL WHERE id = ?",
    ).bind(session.id, buildingId),
    // Same philosophy as the old immediate delete: people aren't deleted,
    // just unassigned, so they show up as unassigned/pending-reassignment.
    env.DB.prepare("UPDATE users SET building_id = NULL WHERE building_id = ?").bind(buildingId),
  ]);
  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleDenyDeleteRequest(request, session, env, corsHeaders) {
  if (session.role !== "admin") return jsonError("Administrator access required.", 403, corsHeaders);
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  await env.DB.prepare("UPDATE buildings SET delete_requested_at = NULL, delete_requested_by = NULL WHERE id = ?")
    .bind(buildingId)
    .run();
  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleDeletedBuildingsList(session, env, corsHeaders) {
  if (session.role !== "admin") return jsonError("Administrator access required.", 403, corsHeaders);
  const result = await env.DB.prepare(
    `SELECT b.id, b.name, b.address, b.region, b.deleted_at, u.full_name AS deleted_by_name
     FROM buildings b LEFT JOIN users u ON u.id = b.deleted_by
     WHERE b.deleted_at IS NOT NULL
     ORDER BY b.deleted_at DESC`,
  ).all();
  const buildings = result.results.map((b) => ({
    ...b,
    daysRemaining: Math.max(
      0,
      RETENTION_DAYS - Math.floor((Date.now() - new Date(`${b.deleted_at}Z`).getTime()) / 86_400_000),
    ),
  }));
  return jsonOk({ buildings }, corsHeaders);
}

export async function handleRestoreBuilding(request, session, env, corsHeaders) {
  if (session.role !== "admin") return jsonError("Administrator access required.", 403, corsHeaders);
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const result = await env.DB.prepare("UPDATE buildings SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL")
    .bind(buildingId)
    .run();
  if (!result.meta.changes) return jsonError("That building isn't in the deleted list.", 404, corsHeaders);
  return jsonOk({ ok: true }, corsHeaders);
}

// Runs daily (see worker/index.js's scheduled()) -- anything soft-deleted
// more than RETENTION_DAYS ago gets permanently, irreversibly purged: every
// reading, tag, work order, notice, location, group, and share, plus its
// R2 photos. This is the only place a building is ever truly destroyed.
export async function purgeExpiredBuildings(env) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const expired = await env.DB.prepare("SELECT id FROM buildings WHERE deleted_at IS NOT NULL AND deleted_at <= ?")
    .bind(cutoff)
    .all();

  for (const { id: buildingId } of expired.results) {
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM inspection_readings WHERE submission_id IN (SELECT id FROM inspection_submissions WHERE building_id = ?)",
      ).bind(buildingId),
      env.DB.prepare(
        "DELETE FROM group_notes WHERE submission_id IN (SELECT id FROM inspection_submissions WHERE building_id = ?)",
      ).bind(buildingId),
      env.DB.prepare("DELETE FROM inspection_submissions WHERE building_id = ?").bind(buildingId),
      env.DB.prepare(
        "DELETE FROM inspection_parameters WHERE tag_id IN (SELECT id FROM inspection_tags WHERE building_id = ?)",
      ).bind(buildingId),
      env.DB.prepare("DELETE FROM inspection_tags WHERE building_id = ?").bind(buildingId),
      // These two were missing from the original delete's cascade -- the
      // real bug behind "crest test 2 isn't working": any building with a
      // custom location or equipment group left a row here that the old
      // DELETE FROM buildings then violated a foreign key against.
      env.DB.prepare("DELETE FROM equipment_groups WHERE building_id = ?").bind(buildingId),
      env.DB.prepare("DELETE FROM building_locations WHERE building_id = ?").bind(buildingId),
      env.DB.prepare("DELETE FROM building_managers WHERE building_id = ?").bind(buildingId),
      env.DB.prepare("DELETE FROM work_orders WHERE building_id = ?").bind(buildingId),
      env.DB.prepare("DELETE FROM building_notices WHERE building_id = ?").bind(buildingId),
      env.DB.prepare("UPDATE users SET building_id = NULL WHERE building_id = ?").bind(buildingId),
      env.DB.prepare("DELETE FROM buildings WHERE id = ?").bind(buildingId),
    ]);

    if (env.PHOTOS) {
      const listed = await env.PHOTOS.list({ prefix: `${buildingId}/` }).catch(() => null);
      if (listed?.objects?.length) {
        await env.PHOTOS.delete(listed.objects.map((o) => o.key)).catch((error) =>
          console.error("Photo cleanup failed during building purge", error),
        );
      }
    }
  }

  return expired.results.length;
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
