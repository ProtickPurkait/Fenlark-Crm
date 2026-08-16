// Service worker for Trace.
//
// Deliberately minimal. Chrome will not fire `beforeinstallprompt` (i.e. the
// app is not installable) unless a service worker with a fetch handler is
// registered — that requirement is the main reason this file exists.
//
// What it does NOT do is cache application data, and that is a safety
// decision rather than an oversight: this is a CRM whose whole job is showing
// a telecaller their *current* queue. A stale cached lead list, or a cached
// HTML page rendered from someone else's session, is far worse than a slow
// one. So only content-hashed build assets are cached; every navigation and
// every Supabase call goes to the network, always.

const STATIC_CACHE = "trace-static-v1";

self.addEventListener("install", (event) => {
  // Take over immediately rather than waiting for every existing tab to close,
  // so a deploy isn't stuck behind a telecaller's long-lived open tab.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== STATIC_CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never touch anything that isn't a plain GET on this origin. That excludes
  // all Supabase traffic (different origin) and every mutation.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Only /_next/static is safe to cache: those filenames contain a content
  // hash, so a changed file is a changed URL and the cache can never go stale.
  const isImmutableAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/");

  if (!isImmutableAsset) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      // Opaque/error responses must not be cached — doing so would pin a
      // failure in place until the cache version is bumped.
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
