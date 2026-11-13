const CACHE = "stationos-mobile-shell-v2";
const PUBLIC_FILES = [
  "/offline.html",
  "/station-icon.svg",
  "/station-icon-192.png",
  "/station-icon-512.png",
  "/pompaci.webmanifest",
];

async function cachePompaciShell(cache) {
  try {
    const response = await fetch("/mobil/pompaci", { cache: "reload" });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return;
    await cache.put("/mobil/pompaci", response.clone());
    const html = await response.text();
    const files = new Set();
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const path = new URL(match[1], self.location.origin).pathname;
      if (path.startsWith("/assets/") && /\.(?:js|css)$/.test(path)) files.add(path);
    }
    await Promise.all([...files].map(async path => {
      try {
        const asset = await fetch(path, { cache: "reload" });
        if (asset.ok) await cache.put(path, asset);
      } catch { /* next online visit can warm this static resource */ }
    }));
  } catch { /* keep the worker installable if the application server is unavailable */ }
}

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(PUBLIC_FILES);
    await cachePompaciShell(cache);
  }));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith("stationos-") && key !== CACHE)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    request.method !== "GET" ||
    url.pathname.startsWith("/api/")
  ) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok && url.pathname === "/mobil/pompaci" && response.headers.get("content-type")?.includes("text/html")) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then(cache => cache.put("/mobil/pompaci", copy)));
          }
          return response;
        })
        .catch(async () => {
          const cached = url.pathname === "/mobil/pompaci"
            ? await caches.match("/mobil/pompaci")
            : null;
          return cached || (await caches.match("/offline.html")) || Response.error();
        })
    );
    return;
  }

  if (PUBLIC_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async cache =>
        (await cache.match(request)) || fetch(request)
      )
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(request);
        const fresh = fetch(request)
          .then(response => {
            if (response.ok) event.waitUntil(cache.put(request, response.clone()));
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
  }
});

// Background Sync wakes an open mobile client to run its authenticated queue.
// The worker never reads or sends private records itself.
self.addEventListener("sync", event => {
  if (event.tag !== "stationos-mobile-outbox") return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(clients => clients.forEach(client => client.postMessage({ type: "STATIONOS_SYNC_OUTBOX" })))
  );
});
