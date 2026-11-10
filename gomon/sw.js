// GoMon service worker: cache-first app shell so the game opens offline
// (walking, dex browsing and practice battles all work without a network).
const CACHE = "gomon-v3";
const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "js/main.js", "js/model.js", "js/jpegmeta.js", "js/db.js", "js/sensors.js",
  "js/openai.js", "js/auth.js", "js/battle.js", "js/lobby.js", "js/lobbylink.js",
  "js/ui.js", "js/game.js", "js/sprites.js", "js/walk.js", "js/capture.js",
  "js/dex.js", "js/lobbyui.js", "js/settings.js", "js/inventory.js", "js/tm.js",
  "js/config.js", "js/zip.js", "js/backup.js",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== "GET") return;
  // Never cache API or cross-origin (OpenAI, lobbylink) traffic.
  if (url.origin !== location.origin || url.pathname.includes("/api/")) return;
  ev.respondWith(
    caches.match(ev.request).then(
      (hit) =>
        hit ??
        fetch(ev.request).then((res) => {
          const copy = res.clone();
          if (res.ok) void caches.open(CACHE).then((c) => c.put(ev.request, copy));
          return res;
        }),
    ),
  );
});
