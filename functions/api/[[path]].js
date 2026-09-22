// Proxies every /api/* request to the real Worker API, so the browser
// only ever talks to ONE origin (this Pages site). Without this, the
// frontend (power-log-command.pages.dev) and the API
// (fhg-command-api.douglasmrgarcia.workers.dev) are different domains,
// making the session cookie a third-party/cross-site cookie -- which
// Safari's Intelligent Tracking Prevention silently drops. Confirmed
// live with a real WebKit test: login succeeded and the API sent
// Set-Cookie, but the browser's cookie jar stayed empty and every
// request after that 401'd, leaving the whole app stuck on "Opening
// command center..." forever -- a real, serious bug on Safari/iPhone,
// not the CSS issue it first looked like. Routing through this
// same-origin proxy makes the cookie a normal first-party one instead,
// which every browser accepts, Safari/iOS included.
const API_ORIGIN = "https://fhg-command-api.douglasmrgarcia.workers.dev";

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, API_ORIGIN);
  const proxied = new Request(target, request);
  return fetch(proxied);
}
