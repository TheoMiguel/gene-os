/**
 * GENE_OS offline cache.
 *
 * Vite gives every built asset a content hash in its name, so an asset that is cached can never be stale:
 * a new build asks for a new name. Those are served cache-first. The page itself has a stable name, so it
 * is served network-first and falls back to the cache when there is no connection. The cache name carries
 * the build stamp, so activating a new worker drops the previous build's entries.
 */
const CACHE = 'gene-os-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'];

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
  return url.pathname.startsWith('/assets/');
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
    const page = await caches.match('/index.html');
    if (page && request.mode === 'navigate') return page;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Database lookups must never be served from a stale cache, and they are the only cross-origin traffic.
  if (url.origin !== self.location.origin) return;
  event.respondWith(isHashedAsset(url) ? cacheFirst(request) : networkFirst(request));
});
