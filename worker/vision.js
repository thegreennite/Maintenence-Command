// Phase 5: AI photo-reading extraction — the original idea this whole
// project started from. A superintendent photographs a gauge cluster,
// the model reads whichever of the expected readings it can actually
// see, and leaves the rest alone rather than guessing.
//
// Uses Google's Gemini API (free tier) rather than a paid Anthropic key —
// same JSON-in/JSON-out contract either way, so swapping providers later
// only means rewriting this one file.
//
// Photos are kept in R2 after a successful read — organized by building
// and day — for audit/compliance evidence and the photo library.

import { storePhoto } from "./photos.js";

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

  // Kept in the library regardless of read quality -- even a blurry attempt
  // is evidence someone was there and tried, not just clean successes.
  await storePhoto(env, {
    buildingId: session.building_id,
    imageBase64,
    mediaType,
    context: "inspection",
    uploadedBy: session.id,
  }).catch((error) => console.error("Photo library store failed", error));

  return jsonOk({ results }, corsHeaders);
}

// Command mode: one tag, one photo, read as fast as possible. Two things
// make this different from the multi-tag group read above: (1) a single
// object response schema instead of an array — smaller schema, smaller
// output, faster generation; (2) the model is explicitly told to check for
// a physical label/sticker/tag matching this exact tag number before
// trusting a value — the whole point being to catch "that's boiler 5F's
// gauge, not 4A's" before a wrong reading ever gets recorded.
export async function handleCommandModePhoto(request, session, env, corsHeaders) {
  if (!env.GOOGLE_AI_KEY) {
    return jsonError("AI photo reading isn't configured on this deployment yet.", 503, corsHeaders);
  }

  const body = await request.json().catch(() => ({}));
  const tagId = Number.parseInt(body.tagId, 10);
  const imageBase64 = body.imageBase64;
  const mediaType = body.mediaType;

  if (!tagId || !imageBase64) return jsonError("A photo and a reading are required.", 400, corsHeaders);
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    return jsonError("Unsupported image type — use JPEG, PNG, or WEBP.", 400, corsHeaders);
  }
  if (imageBase64.length > 6_000_000) {
    return jsonError("That photo is too large. Try again with a smaller image.", 400, corsHeaders);
  }

  const tag = await env.DB.prepare(
    "SELECT id, tag_no, reading_type, unit, value_type FROM inspection_tags WHERE id = ? AND building_id = ?",
  )
    .bind(tagId, session.building_id)
    .first();
  if (!tag) return jsonError("Reading not found for this building.", 404, corsHeaders);

  const label = [tag.tag_no, tag.reading_type].filter(Boolean).join(" — ");
  const hint = tag.value_type === "on_off" ? 'Expected value: "on" or "off".' : tag.unit ? `Unit: ${tag.unit}.` : "";
  const labelCheck = tag.tag_no
    ? `This reading is specifically for the equipment labeled "${tag.tag_no}" — look for that exact tag number on a sticker, plate, or handwritten label near the gauge in the photo. If you can't confirm this photo is actually of "${tag.tag_no}" (e.g. it shows a different tag number, or no tag number is visible at all), set "labelConfirmed" to false and still report the value you see, if any, but flag it.`
    : `This equipment has no specific tag number to verify — set "labelConfirmed" to true as long as a plausible gauge/display is visible.`;

  const prompt = `You are reading one photo taken during a building mechanical inspection, for exactly one reading: "${label}". ${hint}

${labelCheck}

Return one JSON object: {"value": <string reading exactly as shown, e.g. "140" or "on" — or null if not visible/readable>, "unclear": <true if something relevant is visible but too blurry/ambiguous to read confidently>, "labelConfirmed": <true/false per the label check above>}. Never guess — return null instead of a made-up value.`;

  const start = Date.now();
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
            // Single flat object, not an array — keeps the model's output
            // (and therefore its latency) as small as this task allows.
            responseSchema: {
              type: "OBJECT",
              properties: {
                value: { type: "STRING", nullable: true },
                unclear: { type: "BOOLEAN" },
                labelConfirmed: { type: "BOOLEAN" },
              },
              required: ["value", "unclear", "labelConfirmed"],
            },
            // 200 sounded generous for one small object but the model
            // sometimes spends its budget on an unstructured preamble
            // first ("Here is the JSON requested:") and then gets cut off
            // by MAX_TOKENS before ever emitting the object -- confirmed
            // via testing. 500 leaves headroom without adding meaningful
            // latency (completion tokens are cheap; time-to-first-token
            // and image processing are what actually cost seconds here).
            maxOutputTokens: 500,
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
  const elapsedMs = Date.now() - start;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error("Command-mode JSON parse failed, raw text:", JSON.stringify(text), "finishReason:", data?.candidates?.[0]?.finishReason);
    return jsonError("Couldn't understand the AI's response. Try again.", 502, corsHeaders);
  }

  const photoKey = await storePhoto(env, {
    buildingId: session.building_id,
    imageBase64,
    mediaType,
    context: `command-${tag.id}`,
    uploadedBy: session.id,
  }).catch((error) => {
    console.error("Photo library store failed", error);
    return null;
  });

  return jsonOk(
    {
      tagId: tag.id,
      value: parsed?.value ?? null,
      unclear: Boolean(parsed?.unclear),
      labelConfirmed: parsed?.labelConfirmed !== false,
      photoKey,
      elapsedMs,
    },
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
