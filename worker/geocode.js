// Address search for the building-registration map picker. Proxied through
// the Worker so the Maps key used for search stays server-side (the
// separate client-exposed key that renders the map itself is restricted by
// HTTP referrer, which is the normal Google Maps security model).

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export async function handleGeocodeSearch(request, env, corsHeaders) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 3) return jsonOk({ results: [] }, corsHeaders);

  if (!env.GOOGLE_MAPS_API_KEY) {
    return jsonError("Map search isn't configured on this deployment yet.", 503, corsHeaders);
  }

  let response;
  try {
    response = await fetch(PLACES_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify({ textQuery: q }),
    });
  } catch (error) {
    console.error("Places API request failed", error);
    return jsonError("The map search is unavailable right now.", 502, corsHeaders);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error("Places API error", response.status, errText);
    return jsonError("The map search is unavailable right now.", 502, corsHeaders);
  }

  const data = await response.json().catch(() => ({}));
  const results = (data.places || []).map((place) => {
    const name = place.displayName?.text || "";
    const address = place.formattedAddress || "";
    // formattedAddress often already starts with the place name (e.g. a
    // street address search) -- only prepend it when it adds something new.
    const label = name && !address.startsWith(name) ? `${name}, ${address}` : address || name;
    return { label, lat: place.location?.latitude, lon: place.location?.longitude };
  });
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
