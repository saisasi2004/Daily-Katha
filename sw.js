// Offline support: every file the app needs is cached on install, including the
// PDF and Excel libraries, so reports can be exported without a connection.
// Requests are served from the cache first and refreshed in the background,
// so the app opens instantly offline and picks up updates on the next launch.
// Change CACHE whenever you publish a new version.
const CACHE = "daily-katha-v4";

const ASSETS = [
  "./",
  "./index.html",
  "./export.js",
  "./manifest.webmanifest",
  "./vendor/boxicons/css/boxicons.min.css",
  "./vendor/boxicons/fonts/boxicons.woff2",
  "./vendor/fonts/poppins-regular.woff2",
  "./vendor/fonts/poppins-medium.woff2",
  "./vendor/fonts/poppins-semibold.woff2",
  "./vendor/fonts/poppins-bold.woff2",
  "./vendor/fonts/poppins-regular.ttf",
  "./vendor/fonts/poppins-bold.ttf",
  "./vendor/jspdf/jspdf.umd.min.js",
  "./vendor/jspdf/jspdf.plugin.autotable.min.js",
  "./vendor/exceljs/exceljs.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      // "reload" skips the browser's HTTP cache so a new version never caches stale files.
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true }) ||
      (request.mode === "navigate" ? await cache.match("./index.html") : undefined);

    const fromNetwork = fetch(request).then(response => {
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    });

    if (cached) {
      event.waitUntil(fromNetwork.catch(() => {}));
      return cached;
    }

    return fromNetwork;
  })());
});
