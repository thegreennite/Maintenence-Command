// Inspect Funnels service worker.
// Purpose: make the app installable and open instantly. It caches the app shell and its
// (content-hashed) files. It never touches /api/ -- readings, photos, logins and sessions
// always go straight to the network, so nothing private or stale is ever served from here.
const VERSION = "v2";
const SHELL = `if-shell-${VERSION}`;
const FILES = `if-files-${VERSION}`;
const SHELL_URLS = ["/", "/offline", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;

  // Opening the app: always try the network first so a new version shows up; fall back to the
  // last good copy of the page (or the offline notice) when there's no signal.
  if (request.mode === "navigate") {
    event.respondWith(
      withTimeout(fetch(request), 5000)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match("/")) || (await caches.match("/offline"))),
    );
    return;
  }

  // Built files have a hash in their name, so a cached copy is always the right one.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(FILES).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Icons, manifest and the like: show the cached copy now, refresh it in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(FILES).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || refresh;
    }),
  );
});
