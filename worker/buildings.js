// Building registration, AI-assisted checklist generation, and the
// per-building "world" (its own page: notices, recent work orders, recent
// superintendent notes). A Regional Manager sees only buildings they
// personally registered; an Operations Manager (or Admin) sees all of them
// -- see worker/access.js.

import { storePhoto } from "./photos.js";
import { canSeeAllBuildings, ownedOrSharedSql, effectiveClientId, clientScopeSql } from "./access.js";

const VISION_MODEL = "gemini-3.6-flash";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function findOwnedBuilding(env, session, buildingId, columns = "id, name, address, region, inspection_days, status, latitude, longitude, created_by, delete_requested_at") {
  const clientId = effectiveClientId(session);
  if (canSeeAllBuildings(session)) {
    return env.DB.prepare(`SELECT ${columns} FROM buildings WHERE id = ? AND deleted_at IS NULL AND ${clientScopeSql("buildings")}`)
      .bind(buildingId, clientId)
      .first();
  }
  return env.DB.prepare(`SELECT ${columns} FROM buildings WHERE id = ? AND deleted_at IS NULL AND ${clientScopeSql("buildings")} AND ${ownedOrSharedSql("buildings")}`)
    .bind(buildingId, clientId, session.id, session.id)
    .first();
}

export async function handleBuildingsList(session, env, corsHeaders) {
  const scoped = canSeeAllBuildings(session);
  const clientId = effectiveClientId(session);
  const result = await env.DB.prepare(
    `SELECT b.id, b.name, b.address, b.region, b.inspection_days, b.status, b.latitude, b.longitude,
       b.delete_requested_at,
       (SELECT COUNT(*) FROM inspection_tags t WHERE t.building_id = b.id) AS tag_count,
       (SELECT COUNT(*) FROM users u WHERE u.building_id = b.id AND u.role = 'superintendent' AND u.status = 'active') AS superintendent_count,
       b.created_by = ? AS is_owner
     FROM buildings b WHERE b.deleted_at IS NULL AND ${clientScopeSql("b")} ${scoped ? "" : `AND ${ownedOrSharedSql("b")}`} ORDER BY b.id`,
  )
    .bind(session.id, clientId, ...(scoped ? [] : [session.id, session.id]))
    .all();
  return jsonOk({ buildings: result.results }, corsHeaders);
}

export async function handleBuildingCreate(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const address = String(body.address || "").trim();
  const days = Array.isArray(body.inspectionDays)
    ? body.inspectionDays.filter((day) => DAY_NAMES.includes(day))
    : [];
  const latitude = Number.isFinite(body.latitude) ? body.latitude : null;
  const longitude = Number.isFinite(body.longitude) ? body.longitude : null;

  if (!name) return jsonError("A building name is required.", 400, corsHeaders);
  if (!days.length) return jsonError("Select at least one inspection day.", 400, corsHeaders);

  const inspectionDays = DAY_NAMES.filter((day) => days.includes(day)).join(",");
  const clientId = effectiveClientId(session);

  // Basic/Plus plans cap how many buildings a client can register (Pro is
  // unlimited -- building_limit is NULL). Checked here, not just shown in
  // the UI, since this is a real plan boundary, not a suggestion.
  const client = await env.DB.prepare("SELECT building_limit FROM clients WHERE id = ?").bind(clientId).first();
  if (client?.building_limit != null) {
    const { count } = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM buildings WHERE client_id = ? AND deleted_at IS NULL",
    )
      .bind(clientId)
      .first();
    if (count >= client.building_limit) {
      return jsonError(
        `This plan is limited to ${client.building_limit} buildings. Upgrade the plan to add more.`,
        409,
        corsHeaders,
      );
    }
  }

  // Region used to be silently inherited from whoever registered the
  // building (their own account-level "region/team name") -- that's a
  // different concept and produced nonsense like "ON" or "Central
  // Portfolio" showing up on buildings nobody actually labeled. Region
  // is now a per-building label an Area Manager/Admin sets explicitly
  // (see handleUpdateBuilding), starting empty.
  const inserted = await env.DB.prepare(
    `INSERT INTO buildings (name, address, region, inspection_days, created_by, latitude, longitude, status, client_id)
     VALUES (?, ?, NULL, ?, ?, ?, ?, 'registering', ?)`,
  )
    .bind(name, address || null, inspectionDays, session.id, latitude, longitude, clientId)
    .run();

  const building = await env.DB.prepare(
    "SELECT id, name, address, region, inspection_days, status, latitude, longitude FROM buildings WHERE id = ?",
  )
    .bind(inserted.meta.last_row_id)
    .first();

  return jsonOk({ building }, corsHeaders);
}

export async function handleUpdateBuilding(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);

  const building = await findOwnedBuilding(env, session, buildingId, "id");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const name = String(body.name || "").trim();
  const address = String(body.address || "").trim();
  const days = Array.isArray(body.inspectionDays)
    ? body.inspectionDays.filter((day) => DAY_NAMES.includes(day))
    : [];
  const latitude = Number.isFinite(body.latitude) ? body.latitude : null;
  const longitude = Number.isFinite(body.longitude) ? body.longitude : null;
  // Region is a free-text label an Area Manager/Admin sets per building
  // (e.g. "North York") -- not touched at all if the field is omitted,
  // so a plain rename/re-pin doesn't accidentally wipe it.
  const region = body.region !== undefined ? String(body.region || "").trim() || null : undefined;

  if (!name) return jsonError("A building name is required.", 400, corsHeaders);
  if (!days.length) return jsonError("Select at least one inspection day.", 400, corsHeaders);

  if (region !== undefined) {
    await env.DB.prepare("UPDATE buildings SET region = ? WHERE id = ?").bind(region, buildingId).run();
  }
  await env.DB.prepare(
    "UPDATE buildings SET name = ?, address = ?, inspection_days = ?, latitude = ?, longitude = ? WHERE id = ?",
  )
    .bind(name, address || null, DAY_NAMES.filter((d) => days.includes(d)).join(","), latitude, longitude, buildingId)
    .run();

  return jsonOk({ ok: true }, corsHeaders);
}

export async function handlePushLive(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);

  const building = await findOwnedBuilding(env, session, buildingId, "id, status");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);
  if (building.status === "active") return jsonOk({ ok: true, alreadyLive: true }, corsHeaders);

  const tagCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM inspection_tags WHERE building_id = ?")
    .bind(buildingId)
    .first();
  if (!tagCount.count) {
    return jsonError("Build the checklist before pushing this building live.", 409, corsHeaders);
  }

  await env.DB.prepare("UPDATE buildings SET status = 'active' WHERE id = ?").bind(buildingId).run();
  return jsonOk({ ok: true }, corsHeaders);
}

// Deleting a building is two-step now: a Regional/Operations Manager can
// only REQUEST it (the building stays fully live -- nothing changes except
// a flag an Administrator can see). An Administrator's own delete IS the
// approval -- it soft-deletes immediately (see worker/building-deletion.js
// for the admin-side approve/deny/restore endpoints and the 30-day purge).
export async function handleDeleteBuilding(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const confirmationText = String(body.confirmationText || "");

  const building = await findOwnedBuilding(env, session, buildingId, "id, name, delete_requested_at");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  // Enforced server-side too, not just as a UI gate -- the exact phrase has
  // to match the real building name, word for word, before anything wipes.
  const required = `I WANT TO DELETE ${building.name}`;
  if (confirmationText !== required) {
    return jsonError(`Type exactly "${required}" to confirm.`, 400, corsHeaders);
  }

  if (session.role === "admin") {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE buildings SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, delete_requested_at = NULL, delete_requested_by = NULL WHERE id = ?",
      ).bind(session.id, buildingId),
      env.DB.prepare("UPDATE users SET building_id = NULL WHERE building_id = ?").bind(buildingId),
    ]);
    return jsonOk({ ok: true, deleted: true }, corsHeaders);
  }

  if (building.delete_requested_at) {
    return jsonOk({ ok: true, alreadyRequested: true }, corsHeaders);
  }
  await env.DB.prepare("UPDATE buildings SET delete_requested_at = CURRENT_TIMESTAMP, delete_requested_by = ? WHERE id = ?")
    .bind(session.id, buildingId)
    .run();
  return jsonOk({ ok: true, requested: true }, corsHeaders);
}

export async function handleCancelDeleteRequest(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);

  const building = await findOwnedBuilding(env, session, buildingId, "id, delete_requested_by");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);
  if (session.role !== "admin" && building.delete_requested_by !== session.id) {
    return jsonError("Only whoever requested the deletion can cancel it.", 403, corsHeaders);
  }

  await env.DB.prepare("UPDATE buildings SET delete_requested_at = NULL, delete_requested_by = NULL WHERE id = ?")
    .bind(buildingId)
    .run();
  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleUnassignedSuperintendents(session, env, corsHeaders) {
  const result = await env.DB.prepare(
    "SELECT id, username, full_name FROM users WHERE role = 'superintendent' AND building_id IS NULL AND is_active = 1 AND client_id = ? ORDER BY full_name",
  )
    .bind(effectiveClientId(session))
    .all();
  return jsonOk({ superintendents: result.results }, corsHeaders);
}

// A ROM can assign an unassigned super, or move one off a building they
// themselves own -- not "steal" one off a building they don't own. An OM
// (or admin) can move anyone, same as their blanket building visibility.
export async function handleAssignableSuperintendents(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  const building = await findOwnedBuilding(env, session, buildingId, "id");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const scoped = canSeeAllBuildings(session);
  const clientId = effectiveClientId(session);
  const result = await env.DB.prepare(
    `SELECT u.id, u.full_name, u.building_id, b.name AS building_name
     FROM users u LEFT JOIN buildings b ON b.id = u.building_id
     WHERE u.role = 'superintendent' AND u.is_active = 1 AND u.status = 'active' AND u.client_id = ?
       AND (u.building_id IS NULL OR u.building_id != ?)
       AND (u.building_id IS NULL ${scoped ? "" : `OR ${ownedOrSharedSql("b")}`})
     ORDER BY u.full_name`,
  )
    .bind(clientId, buildingId, ...(scoped ? [] : [session.id, session.id]))
    .all();
  return jsonOk({ superintendents: result.results }, corsHeaders);
}

export async function handleAssignSuperintendent(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const userId = Number.parseInt(body.userId, 10);

  const building = await findOwnedBuilding(env, session, buildingId, "id, region");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const target = await env.DB.prepare(
    "SELECT id, building_id FROM users WHERE id = ? AND role = 'superintendent' AND is_active = 1 AND client_id = ?",
  )
    .bind(userId, effectiveClientId(session))
    .first();
  if (!target) return jsonError("Superintendent not found.", 404, corsHeaders);
  if (target.building_id && !(await findOwnedBuilding(env, session, target.building_id, "id"))) {
    return jsonError("That superintendent is assigned to a building you don't manage.", 403, corsHeaders);
  }

  await env.DB.prepare("UPDATE users SET building_id = ?, region = ? WHERE id = ?")
    .bind(buildingId, building.region, userId)
    .run();

  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleRemoveSuperintendent(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const userId = Number.parseInt(body.userId, 10);

  const target = await env.DB.prepare(
    "SELECT id, building_id FROM users WHERE id = ? AND role = 'superintendent' AND is_active = 1 AND client_id = ?",
  )
    .bind(userId, effectiveClientId(session))
    .first();
  if (!target || !target.building_id) return jsonError("That superintendent isn't assigned to a building.", 404, corsHeaders);
  if (!(await findOwnedBuilding(env, session, target.building_id, "id"))) {
    return jsonError("That superintendent is assigned to a building you don't manage.", 403, corsHeaders);
  }

  await env.DB.prepare("UPDATE users SET building_id = NULL WHERE id = ?").bind(userId).run();
  return jsonOk({ ok: true }, corsHeaders);
}

const MAX_SHEET_PHOTOS = 20;

export async function handleGenerateTags(request, session, env, corsHeaders) {
  if (!env.GOOGLE_AI_KEY) {
    return jsonError("AI checklist generation isn't configured on this deployment yet.", 503, corsHeaders);
  }

  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  // Back-compat: a single {imageBase64, mediaType} still works, but the
  // real path now is images: [{data, mediaType}] for a multi-page form.
  const images = Array.isArray(body.images)
    ? body.images
    : body.imageBase64
      ? [{ data: body.imageBase64, mediaType: body.mediaType }]
      : [];

  if (!images.length) return jsonError("At least one photo or PDF of the paper inspection sheet is required.", 400, corsHeaders);
  if (images.length > MAX_SHEET_PHOTOS) return jsonError(`Up to ${MAX_SHEET_PHOTOS} files at a time.`, 400, corsHeaders);
  for (const img of images) {
    if (!img.data || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(img.mediaType)) {
      return jsonError("Unsupported file type — use JPEG, PNG, WEBP, or PDF.", 400, corsHeaders);
    }
  }

  const building = buildingId ? await findOwnedBuilding(env, session, buildingId, "id") : null;

  const prompt = `These ${images.length > 1 ? `${images.length} attachments (photos and/or PDF scans) are pages/sections of` : "is a photo or PDF scan of"} a paper building-inspection checklist (a "daily log" sheet used by a building superintendent — things like boilers, pumps, cooling towers, fire safety, elevators). A PDF may itself contain multiple pages — read all of them. Extract every distinct reading the form asks the inspector to record, EXCLUDING any row that looks crossed out, struck through, or otherwise marked as not tracked. ${images.length > 1 ? "Combine everything from every attachment into ONE list — do not repeat a reading that appears more than once." : ""}

For each reading, determine:
- system_name: the section/category it's under (e.g. "Building Heating", "Fire Safety Systems")
- tag_no: the specific equipment label if there is one (e.g. "Boiler: H1A"), or null if the reading applies to the building generally (e.g. "Outside temperature")
- reading_type: what's being read (e.g. "Inlet temperature", "on/off", "Pressure")
- unit: the unit shown (e.g. "°", "PSI", "%"), or null if none
- value_type: a sprinkler VALVE'S POSITION reading is ALWAYS "open_closed" — never "on_off", never "hoa" — no exceptions. This applies only to the position/status reading itself; a "Sprinkler System" section commonly also has plain numeric readings sitting right next to that valve (water pressure, air pressure, etc.) — those stay "numeric" like any other gauge, don't force them to "open_closed" just because they're under the same sprinkler section. Otherwise: "on_off" if this reading is literally an on/off state; "open_closed" if it's a valve or damper reading that's specifically Open or Closed rather than on/off; "hoa" if it's a Hand-Off-Auto selector switch (common on pumps, fans, blowers, motors — the equipment can be found in Hand/manual-forced-on, Off, or Auto/automatic-control); otherwise "numeric"

Return a JSON array of objects with exactly those five fields. If you can't read the sheet(s) clearly enough to extract anything reliably, return an empty array rather than guessing.`;

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${env.GOOGLE_AI_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                ...images.map((img) => ({ inline_data: { mime_type: img.mediaType, data: img.data } })),
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  system_name: { type: "STRING" },
                  tag_no: { type: "STRING", nullable: true },
                  reading_type: { type: "STRING" },
                  unit: { type: "STRING", nullable: true },
                  value_type: { type: "STRING", enum: ["numeric", "on_off", "hoa", "open_closed"] },
                },
                required: ["system_name", "reading_type", "value_type"],
              },
            },
          },
        }),
      },
    );
  } catch (error) {
    console.error("Gemini API request failed", error);
    return jsonError("Couldn't reach the AI reading service. Try again.", 502, corsHeaders);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error("Gemini API error", response.status, errText);
    return jsonError("The AI reading service is unavailable right now.", 502, corsHeaders);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonError("Couldn't understand the AI's response. Try again.", 502, corsHeaders);
  }
  if (!Array.isArray(parsed)) parsed = [];

  if (building) {
    await Promise.all(
      images.map((img) =>
        storePhoto(env, {
          buildingId: building.id,
          imageBase64: img.data,
          mediaType: img.mediaType,
          context: "checklist-setup",
          uploadedBy: session.id,
        }).catch((error) => console.error("Photo library store failed", error)),
      ),
    );
  }

  return jsonOk({ proposedTags: parsed }, corsHeaders);
}

export async function handleSaveTags(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const tags = Array.isArray(body.tags) ? body.tags : [];

  const building = await findOwnedBuilding(env, session, buildingId, "id");
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM inspection_tags WHERE building_id = ?")
    .bind(buildingId)
    .first();
  if (existing.count > 0) {
    return jsonError("This building already has a checklist. Editing an existing checklist isn't supported yet.", 409, corsHeaders);
  }

  const validRows = tags
    .map((tag, index) => {
      const systemName = String(tag.system_name || "").trim();
      const tagNo = tag.tag_no ? String(tag.tag_no).trim() : null;
      const readingType = String(tag.reading_type || "").trim();
      // Hard rule, not a suggestion: a reading that's actually about a
      // sprinkler VALVE's position is always Open/Closed, no matter what
      // the AI extraction guessed or what a manager picked by hand.
      // Deliberately checks only tag_no/reading_type, NOT system_name --
      // real data confirmed why: a "Sprinkler System" section legitimately
      // also holds plain numeric readings under the same valve (water/air
      // pressure gauges alongside it), and matching on the section name
      // would have wrongly forced those to Open/Closed too.
      const isSprinkler = /sprinkler/i.test(`${tagNo || ""} ${readingType}`);
      return {
        systemName,
        tagNo,
        readingType,
        unit: tag.unit ? String(tag.unit).trim() : null,
        valueType: isSprinkler
          ? "open_closed"
          : ["on_off", "hoa", "open_closed"].includes(tag.value_type)
            ? tag.value_type
            : "numeric",
        sortOrder: index + 1,
      };
    })
    .filter((row) => row.systemName && row.readingType);

  if (!validRows.length) return jsonError("At least one valid reading is required.", 400, corsHeaders);

  await env.DB.batch(
    validRows.map((row) =>
      env.DB.prepare(
        `INSERT INTO inspection_tags (building_id, system_name, tag_no, reading_type, unit, answer_kind, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(buildingId, row.systemName, row.tagNo, row.readingType, row.unit, row.valueType, row.sortOrder),
    ),
  );

  // Auto-create one machine (equipment group) per distinct tag_no --
  // every reading sharing a tag_no is the same physical piece of
  // equipment (e.g. every "Boiler: H1A" reading), so this is exactly the
  // grouping a manager would set up by hand anyway. Readings with no
  // tag_no (building-general ones like "Outside temperature") are left
  // ungrouped on purpose -- there's no single machine to require a
  // photo of. A manager can still rename, merge, split, or drag readings
  // between machines afterward (see worker/groups.js).
  const distinctTagNos = [...new Set(validRows.map((r) => r.tagNo).filter(Boolean))];
  if (distinctTagNos.length) {
    await env.DB.batch(
      distinctTagNos.map((name, index) =>
        env.DB.prepare("INSERT INTO equipment_groups (building_id, name, sort_order) VALUES (?, ?, ?)").bind(
          buildingId,
          name,
          index,
        ),
      ),
    );
    await env.DB.prepare(
      `UPDATE inspection_tags
       SET equipment_group_id = (
         SELECT eg.id FROM equipment_groups eg
         WHERE eg.building_id = inspection_tags.building_id AND eg.name = inspection_tags.tag_no
       )
       WHERE building_id = ? AND tag_no IS NOT NULL`,
    )
      .bind(buildingId)
      .run();
  }

  return jsonOk({ ok: true, count: validRows.length }, corsHeaders);
}

// The per-building "world": its checklist, recent work orders (open and
// resolved, not just the manager's cross-building queue), the notices
// board, and the superintendent's recent daily comments.
export async function handleBuildingDetail(request, session, env, corsHeaders) {
  const buildingId = Number.parseInt(new URL(request.url).searchParams.get("buildingId"), 10);
  const building = await findOwnedBuilding(env, session, buildingId);
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const [tags, workOrders, notices, recentNotes, superintendents, locations, groups, groupNotes, todayGroupPhotos] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, t.system_name, t.tag_no, t.reading_type, t.unit, t.answer_kind AS value_type,
         t.location_id, l.name AS location_name, t.equipment_group_id, g.name AS equipment_group_name
       FROM inspection_tags t
       LEFT JOIN building_locations l ON l.id = t.location_id
       LEFT JOIN equipment_groups g ON g.id = t.equipment_group_id
       WHERE t.building_id = ? ORDER BY t.sort_order`,
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      `SELECT w.id, w.source, w.category, w.title, w.description, w.status, w.created_at, w.resolved_at,
         u.full_name AS reported_by, assignee.full_name AS assigned_to_name
       FROM work_orders w
       LEFT JOIN users u ON u.id = w.created_by
       LEFT JOIN users assignee ON assignee.id = w.assigned_to
       WHERE w.building_id = ? ORDER BY w.created_at DESC LIMIT 30`,
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      `SELECT n.id, n.message, n.created_at, u.full_name AS created_by_name
       FROM building_notices n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.building_id = ? ORDER BY n.created_at DESC`,
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      `SELECT inspection_date, notes, submitted_at FROM inspection_submissions
       WHERE building_id = ? AND notes IS NOT NULL AND TRIM(notes) != ''
       ORDER BY inspection_date DESC LIMIT 10`,
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      "SELECT id, full_name FROM users WHERE building_id = ? AND role = 'superintendent' AND status = 'active'",
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare("SELECT id, name, sort_order FROM building_locations WHERE building_id = ? ORDER BY sort_order, name")
      .bind(buildingId)
      .all(),
    env.DB.prepare("SELECT id, name, sort_order, requires_photo FROM equipment_groups WHERE building_id = ? ORDER BY sort_order, name")
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      `SELECT gn.equipment_group_id, g.name AS group_name, gn.note, gn.updated_at, s.inspection_date
       FROM group_notes gn
       JOIN inspection_submissions s ON s.id = gn.submission_id
       JOIN equipment_groups g ON g.id = gn.equipment_group_id
       WHERE s.building_id = ? ORDER BY s.inspection_date DESC LIMIT 20`,
    )
      .bind(buildingId)
      .all(),
    env.DB.prepare(
      `SELECT gp.equipment_group_id, gp.photo_key, gp.captured_at, gp.latitude, gp.longitude
       FROM group_photos gp
       JOIN inspection_submissions s ON s.id = gp.submission_id
       WHERE s.building_id = ? AND s.inspection_date = ?`,
    )
      .bind(buildingId, todayToronto())
      .all(),
  ]);

  return jsonOk(
    {
      building,
      tags: tags.results,
      workOrders: workOrders.results,
      notices: notices.results,
      recentNotes: recentNotes.results,
      groupNotes: groupNotes.results,
      todayGroupPhotos: todayGroupPhotos.results,
      superintendents: superintendents.results,
      locations: locations.results,
      groups: groups.results,
    },
    corsHeaders,
  );
}

// Toronto time, not UTC -- same reasoning as every other "today" in this
// app (worker/inspections.js): an inspection day turns over at midnight
// ET, not whenever UTC happens to roll.
function todayToronto() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
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
