const CACHE = "stationos-public-shell-v1";
const PUBLIC_FILES = ["/offline.html", "/station-icon.svg", "/station-icon-192.png", "/station-icon-512.png"];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_FILES))); self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("stationos-public-shell-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (PUBLIC_FILES.includes(url.pathname)) { event.respondWith(caches.open(CACHE).then(cache => cache.match(request)).then(cached => cached || fetch(request))); return; }
  if (request.mode === "navigate") event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
});
