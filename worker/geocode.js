// Address search for the building-registration map picker, proxied through
// the Worker so we can set a proper User-Agent (Nominatim's usage policy
// requires one identifying the app — browsers won't let client-side code
// set that header) and keep the free OpenStreetMap geocoder's request
// pattern well-behaved rather than hitting it straight from the browser.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export async function handleGeocodeSearch(request, corsHeaders) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 3) return jsonOk({ results: [] }, corsHeaders);

  const upstream = new URL(NOMINATIM_URL);
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("limit", "5");

  let response;
  try {
    response = await fetch(upstream, {
      headers: { "User-Agent": "FHG-Command/1.0 (building registration; contact: ops@forest-hill-group.example)" },
    });
  } catch (error) {
    console.error("Nominatim request failed", error);
    return jsonError("The map search is unavailable right now.", 502, corsHeaders);
  }

  if (!response.ok) return jsonError("The map search is unavailable right now.", 502, corsHeaders);

  const data = await response.json().catch(() => []);
  const results = (Array.isArray(data) ? data : []).map((item) => ({
    label: item.display_name,
    lat: Number.parseFloat(item.lat),
    lon: Number.parseFloat(item.lon),
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
