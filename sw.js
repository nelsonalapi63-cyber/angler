/* FATHOM — service worker. Pre-caches the whole static site, serves cache-first for same-origin files,
 * refreshes the cache in the background so updates arrive on the next load, and never touches
 * cross-origin requests (Supabase, Stripe, ads, analytics). Bump CACHE_VERSION on every release. */
const CACHE_VERSION = 'fathom-v1.0.0';
const PRECACHE = [
  './', 'index.html', 'styles.css', 'app.js', 'game.js', 'pages.js', 'storage.js', 'charts.js',
  'online.js', 'monetise.js', 'entities.js', 'prompts.js', 'shared/dive.js', 'manifest.json',
  'privacy.html', 'terms.html', 'refunds.html', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null)))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // network only for everything cross-origin
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      const refresh = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => null);
        return res;
      }).catch(() => null);
      if (cached) { refresh.catch(() => null); return cached; }
      const fresh = await refresh;
      if (fresh) return fresh;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
      return Response.error();
    })
  );
});
