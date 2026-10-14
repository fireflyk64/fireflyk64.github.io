// Retired. Mantle of Ophion moved from the site root to /moo/, which registers
// its own cross-origin-isolation worker scoped to /moo/. Browsers that still
// hold the old site-wide registration fetch this file on their next visit,
// install it, and it unregisters itself. It handles no fetches, so pages it
// still controls until then load straight from the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister());
});
