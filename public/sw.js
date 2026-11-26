/**
 * GENE_OS offline cache.
 *
 * Vite gives every built asset a content hash in its name, so a cached asset can never be stale: a new
 * build asks for a new name. Those are served cache-first. The page itself has a stable name, so it is
 * served network-first and falls back to the cache when there is no connection. Activating a new worker
 * drops the previous cache.
 *
 * Paths are resolved against the worker's own scope, because the app is also served under a project path
 * such as /gene-os/.
 */
const CACHE = 'gene-os-v1';
const SCOPE = new URL(self.registration.scope);
const PRECACHE = ['', 'index.html', 'manifest.webmanifest', 'favicon.svg'].map(
  (path) => new URL(path, SCOPE).href,
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

/** True for a build output whose file name already identifies its content. */
function isHashedAsset(url) {
  return url.pathname.startsWith(`${SCOPE.pathname}assets/`);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const page = await caches.match(new URL('index.html', SCOPE).href);
      if (page) return page;
    }
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Database lookups must never be served from a stale cache, and they are the only cross-origin traffic.
  if (url.origin !== SCOPE.origin) return;
  event.respondWith(isHashedAsset(url) ? cacheFirst(request) : networkFirst(request));
});
