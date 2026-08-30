// Phase 6: building registration + AI-assisted checklist generation from
// an uploaded paper inspection sheet. The AI proposes a tag list; nothing
// goes live until the regional manager reviews and confirms it — same
// "never trust a blind AI commit" principle as Phase 5's photo reading.

const VISION_MODEL = "gemini-3.6-flash";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function handleBuildingsList(session, env, corsHeaders) {
  const result = await env.DB.prepare(
    `SELECT b.id, b.name, b.address, b.region, b.inspection_days,
       (SELECT COUNT(*) FROM inspection_tags t WHERE t.building_id = b.id) AS tag_count,
       (SELECT COUNT(*) FROM users u WHERE u.building_id = b.id AND u.role = 'superintendent') AS superintendent_count
     FROM buildings b WHERE b.region = ? ORDER BY b.id`,
  )
    .bind(session.region)
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

  if (!name) return jsonError("A building name is required.", 400, corsHeaders);
  if (!days.length) return jsonError("Select at least one inspection day.", 400, corsHeaders);

  const inspectionDays = DAY_NAMES.filter((day) => days.includes(day)).join(",");

  const inserted = await env.DB.prepare(
    "INSERT INTO buildings (name, address, region, inspection_days, created_by) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(name, address || null, session.region, inspectionDays, session.id)
    .run();

  const building = await env.DB.prepare(
    "SELECT id, name, address, region, inspection_days FROM buildings WHERE id = ?",
  )
    .bind(inserted.meta.last_row_id)
    .first();

  return jsonOk({ building }, corsHeaders);
}

export async function handleUnassignedSuperintendents(session, env, corsHeaders) {
  const result = await env.DB.prepare(
    "SELECT id, username, full_name FROM users WHERE role = 'superintendent' AND building_id IS NULL AND is_active = 1 ORDER BY full_name",
  ).all();
  return jsonOk({ superintendents: result.results }, corsHeaders);
}

export async function handleAssignSuperintendent(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const userId = Number.parseInt(body.userId, 10);

  const building = await env.DB.prepare("SELECT id, region FROM buildings WHERE id = ? AND region = ?")
    .bind(buildingId, session.region)
    .first();
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const result = await env.DB.prepare(
    "UPDATE users SET building_id = ?, region = ? WHERE id = ? AND role = 'superintendent' AND building_id IS NULL",
  )
    .bind(buildingId, session.region, userId)
    .run();

  if (!result.meta.changes) {
    return jsonError("That superintendent is already assigned elsewhere, or doesn't exist.", 409, corsHeaders);
  }

  return jsonOk({ ok: true }, corsHeaders);
}

export async function handleGenerateTags(request, session, env, corsHeaders) {
  if (!env.GOOGLE_AI_KEY) {
    return jsonError("AI checklist generation isn't configured on this deployment yet.", 503, corsHeaders);
  }

  const body = await request.json().catch(() => ({}));
  const imageBase64 = body.imageBase64;
  const mediaType = body.mediaType;
  if (!imageBase64 || !["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    return jsonError("A photo of the paper inspection sheet is required.", 400, corsHeaders);
  }

  const prompt = `This is a photo of a paper building-inspection checklist (a "daily log" sheet used by a building superintendent — things like boilers, pumps, cooling towers, fire safety, elevators). Extract every distinct reading the form asks the inspector to record, EXCLUDING any row that looks crossed out, struck through, or otherwise marked as not tracked.

For each reading, determine:
- system_name: the section/category it's under (e.g. "Building Heating", "Fire Safety Systems")
- tag_no: the specific equipment label if there is one (e.g. "Boiler: H1A"), or null if the reading applies to the building generally (e.g. "Outside temperature")
- reading_type: what's being read (e.g. "Inlet temperature", "on/off", "Pressure")
- unit: the unit shown (e.g. "°", "PSI", "%"), or null if none
- value_type: "on_off" if this reading is literally an on/off or open/closed state, otherwise "numeric"

Return a JSON array of objects with exactly those five fields. If you can't read the sheet clearly enough to extract anything reliably, return an empty array rather than guessing.`;

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${env.GOOGLE_AI_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: imageBase64 } }, { text: prompt }] }],
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
                  value_type: { type: "STRING", enum: ["numeric", "on_off"] },
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

  return jsonOk({ proposedTags: parsed }, corsHeaders);
}

export async function handleSaveTags(request, session, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const buildingId = Number.parseInt(body.buildingId, 10);
  const tags = Array.isArray(body.tags) ? body.tags : [];

  const building = await env.DB.prepare("SELECT id, region FROM buildings WHERE id = ? AND region = ?")
    .bind(buildingId, session.region)
    .first();
  if (!building) return jsonError("Building not found.", 404, corsHeaders);

  const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM inspection_tags WHERE building_id = ?")
    .bind(buildingId)
    .first();
  if (existing.count > 0) {
    return jsonError("This building already has a checklist. Editing an existing checklist isn't supported yet.", 409, corsHeaders);
  }

  const validRows = tags
    .map((tag, index) => ({
      systemName: String(tag.system_name || "").trim(),
      tagNo: tag.tag_no ? String(tag.tag_no).trim() : null,
      readingType: String(tag.reading_type || "").trim(),
      unit: tag.unit ? String(tag.unit).trim() : null,
      valueType: tag.value_type === "on_off" ? "on_off" : "numeric",
      sortOrder: index + 1,
    }))
    .filter((row) => row.systemName && row.readingType);

  if (!validRows.length) return jsonError("At least one valid reading is required.", 400, corsHeaders);

  await env.DB.batch(
    validRows.map((row) =>
      env.DB.prepare(
        `INSERT INTO inspection_tags (building_id, system_name, tag_no, reading_type, unit, value_type, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(buildingId, row.systemName, row.tagNo, row.readingType, row.unit, row.valueType, row.sortOrder),
    ),
  );

  return jsonOk({ ok: true, count: validRows.length }, corsHeaders);
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
