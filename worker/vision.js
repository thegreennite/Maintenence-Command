// Phase 5: AI photo-reading extraction — the original idea this whole
// project started from. A superintendent photographs a gauge cluster,
// the model reads whichever of the expected readings it can actually
// see, and leaves the rest alone rather than guessing.
//
// Uses Google's Gemini API (free tier) rather than a paid Anthropic key —
// same JSON-in/JSON-out contract either way, so swapping providers later
// only means rewriting this one file.
//
// Photos are NOT persisted (no R2 bucket wired up yet) — processed
// transiently and discarded. Worth adding later for audit/compliance
// evidence, but not required for the core extraction to work.

const VISION_MODEL = "gemini-3.6-flash";
const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function handleInspectionPhoto(request, session, env, corsHeaders) {
  if (!env.GOOGLE_AI_KEY) {
    return jsonError("AI photo reading isn't configured on this deployment yet.", 503, corsHeaders);
  }

  const body = await request.json().catch(() => ({}));
  const tagIds = Array.isArray(body.tagIds) ? body.tagIds.map((id) => Number.parseInt(id, 10)) : [];
  const imageBase64 = body.imageBase64;
  const mediaType = body.mediaType;

  if (!tagIds.length || !imageBase64) {
    return jsonError("A photo and at least one reading are required.", 400, corsHeaders);
  }
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return jsonError("Unsupported image type — use JPEG, PNG, or WEBP.", 400, corsHeaders);
  }
  if (imageBase64.length > 6_000_000) {
    return jsonError("That photo is too large. Try again with a smaller image.", 400, corsHeaders);
  }

  const placeholders = tagIds.map(() => "?").join(",");
  const tags = await env.DB.prepare(
    `SELECT id, tag_no, reading_type, unit, value_type FROM inspection_tags
     WHERE building_id = ? AND id IN (${placeholders})`,
  )
    .bind(session.building_id, ...tagIds)
    .all();

  const tagById = new Map(tags.results.map((tag) => [tag.id, tag]));
  const orderedTags = tagIds.map((id) => tagById.get(id)).filter(Boolean);
  if (!orderedTags.length) {
    return jsonError("No matching readings found for this building.", 400, corsHeaders);
  }

  const listing = orderedTags
    .map((tag, index) => {
      const label = [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ");
      const hint = tag.value_type === "on_off" ? '(expected value: "on" or "off")' : tag.unit ? `(unit: ${tag.unit})` : "";
      return `${index + 1}. ${label} ${hint}`.trim();
    })
    .join("\n");

  const prompt = `You are reading a photo taken during a building mechanical inspection. Below is a numbered list of specific readings the inspector needs from this photo. For each one, look for a matching gauge, digital display, label, or indicator light in the photo.

${listing}

Return a JSON array of exactly ${orderedTags.length} objects, one per numbered reading above, in the same order. Each object: {"value": <string, e.g. "140" or "on" — or null if this reading is not visible or not identifiable in this photo>, "unclear": <true only if something relevant IS visible but too blurry or ambiguous to read confidently, otherwise false>}. Never guess a value you cannot actually read — return null instead.`;

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
              parts: [{ inline_data: { mime_type: mediaType, data: imageBase64 } }, { text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  value: { type: "STRING", nullable: true },
                  unclear: { type: "BOOLEAN" },
                },
                required: ["value", "unclear"],
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonError("Couldn't understand the AI's response. Try again.", 502, corsHeaders);
  }

  if (!Array.isArray(parsed) || parsed.length !== orderedTags.length) {
    return jsonError("The AI response didn't match the expected readings. Try again.", 502, corsHeaders);
  }

  const results = orderedTags.map((tag, index) => ({
    tagId: tag.id,
    value: parsed[index]?.value ?? null,
    unclear: Boolean(parsed[index]?.unclear),
  }));

  return jsonOk({ results }, corsHeaders);
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
