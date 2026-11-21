// FixSight service worker: makes the app open offline. Saved inspections live
// in IndexedDB; this caches only the app's own files. API calls always go to
// the network and are never cached.
const VERSION = "fixsight-shell-2026-11-21-3";
const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/js/main.js",
  "/js/ui.js",
  "/js/db.js",
  "/js/api.js",
  "/js/photos.js",
  "/js/analysis-view.js",
  "/js/report.js",
  "/js/voice.js",
  "/js/screens/scan.js",
  "/js/screens/inspection.js",
  "/js/screens/inspections.js",
  "/js/screens/jobs.js",
  "/js/screens/settings.js",
  "/vendor/jspdf.umd.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_vercel/")) return;

  if (request.mode === "navigate") {
    // Network first so updates arrive promptly; the cached shell when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Network first, cache as the offline fallback. Serving cached modules
  // while online could mix files from two releases after a deploy.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});
