/* Vanilla PWA service worker — offline shell cache + prompt-mode updates. No build step.
   ────────────────────────────────────────────────────────────────────────────
   Pairs with pwa-register.js (registration + update toast) and manifest.json.

   STRATEGY (only ever touches SAME-ORIGIN GET — see the fetch handler):
     • navigations (your HTML)  → NETWORK-FIRST: online gets the newest build; offline
       falls back to the last cached copy. No "stuck a version behind" trap.
     • other same-origin assets → STALE-WHILE-REVALIDATE: instant from cache, refreshed
       in the background for next launch.
     • everything else (POSTs, cross-origin API/auth) is NOT intercepted.

   UPDATES (prompt mode): a freshly-installed worker parks in "waiting" (we do NOT
   skipWaiting() on install). pwa-register.js notices it, shows a "New version" toast, and
   on tap posts SKIP_WAITING (handled below) → activate → the page reloads on
   controllerchange. Bump CACHE_VERSION on each deploy you want to surface (a timestamp is
   ideal); that changes THIS file, which is what makes the browser detect an update.
*/

// 👉 CUSTOMIZE: rename to your app, and bump CACHE_VERSION per deploy (e.g. a build stamp).
const CACHE_VERSION = "v1";
const CACHE_NAME    = `primos-run-${CACHE_VERSION}`;

// 👉 CUSTOMIZE: the offline shell, precached at install. Relative paths (resolved against
// this worker's URL) so a root OR subdirectory deploy both work. List only files that
// exist — each is added individually below so one 404 can't fail the whole install.
const PRECACHE = [
  "./",                 // start_url → index.html
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./css/style.css",
  "./pwa-register.js",
  "./js/main.js",
  "./js/game.js",
  "./js/render.js",
  "./js/camera.js",
  "./js/world.js",
  "./js/config.js",
  "./js/hud.js",
  "./js/input.js",
  "./js/audio.js",
  "./js/store.js",
  "./js/particles.js",
  "./js/art/palette.js",
  "./js/art/runner.js",
  "./js/art/props.js",
  "./js/art/scenery.js",
  "./js/art/primo-head.js",
  "./js/art/sprites.js",
  "./data/primos-index.json",
  "./art/torso.png",
  "./art/upperarm.png",
  "./art/forearm.png",
  "./art/thigh.png",
  "./art/shin.png",
  "./art/shoe.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
    // No skipWaiting() here — park in "waiting" so the page can prompt first. The very
    // first install still activates immediately (no old worker to wait behind).
  })());
});

// Prompt-mode handoff: pwa-register.js posts this when the user taps REFRESH.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // never touch POSTs (API writes, auth)
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;        // never touch cross-origin

  if (req.mode === "navigate") {                          // pages → network-first
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        return (await cache.match(req)) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {                        // assets → stale-while-revalidate
    const cache  = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
      .catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
