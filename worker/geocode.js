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

// Street address for a photo's GPS fix, shown to managers next to the time
// it was taken. OpenStreetMap's free lookup: Google's own reverse-geocoding
// needs billing enabled on the project and its nearby-place search returns
// business listings, not the address. Results are cached for 90 days by
// coordinates rounded to ~11 m (a building's photos all share one lookup),
// and OSM's usage policy -- an identifying User-Agent, light use -- is met.
const REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const CACHE_SECONDS = 60 * 60 * 24 * 90;

function shortAddress(a = {}, fallback = "") {
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const city = a.city || a.town || a.village || a.municipality || a.suburb || "";
  const region = String(a["ISO3166-2-lvl4"] || "").split("-")[1] || a.state || "";
  const line = [street, city, [region, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return line || fallback;
}

export async function handleReverseGeocode(request, session, env, corsHeaders) {
  if (session.role !== "regional_manager" && session.role !== "admin") return jsonError("Not available for this role.", 403, corsHeaders);
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return jsonError("A valid location is required.", 400, corsHeaders);
  }
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cacheKey = new Request(`https://reverse-geocode.internal/${key}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = cache ? await cache.match(cacheKey).catch(() => null) : null;
  if (hit) return jsonOk(await hit.json(), corsHeaders);

  let address = "";
  try {
    const response = await fetch(`${REVERSE_URL}?format=jsonv2&zoom=18&addressdetails=1&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, {
      headers: { "User-Agent": "PowerLogCommand/1.0 (lucas.garcia.gla@gmail.com)", Accept: "application/json" },
    });
    if (response.ok) {
      const data = await response.json();
      address = shortAddress(data.address, String(data.display_name || "").split(",").slice(0, 3).join(","));
    }
  } catch (error) {
    console.error("Reverse geocode failed", error);
  }
  // A failed lookup isn't cached, so the next view tries again.
  const body = { address: address || null, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };
  if (address && cache) {
    await cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_SECONDS}` } })).catch(() => {});
  }
  return jsonOk(body, corsHeaders);
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
