/* ANGLER — service worker. Pre-caches the app shell and today's boot bundle, serves cache-first for same-origin
 * files, refreshes the cache in the background so updates arrive on the next load, and never touches cross-origin
 * requests (Supabase, Stripe, ads, analytics). The full answer bank (entities.js, prompts.js, taxa.js — a few MB)
 * is not pre-cached: it is fetched network-first the first time the page needs or warms it, and cached then.
 * Bump CACHE_VERSION on every release. */
const CACHE_VERSION = 'angler-v2.1.0';
const PRECACHE = [
  './', 'index.html', 'styles.css', 'app.js', 'game.js', 'pages.js', 'storage.js', 'charts.js', 'achievements.js', 'share.js',
  'surface.js', 'retain.js', 'social.js', 'online.js', 'monetise.js', 'boot.js', 'shared/dive.js', 'manifest.json',
  'fonts/fonts.css', 'fonts/outfit-latin-wght.woff2', 'fonts/inter-latin-wght.woff2',
  'privacy.html', 'terms.html', 'refunds.html', 'icons/favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png', 'icons/og.png',
];
// The answer bank and schedule must be fresh whenever the network is there, so the day's prompts match the server.
const NETWORK_FIRST = ['boot.js', 'entities.js', 'prompts.js', 'taxa.js'];

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
  const file = url.pathname.split('/').pop();
  if (NETWORK_FIRST.includes(file)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => null);
          return fresh;
        } catch (e) {
          return (await cache.match(req)) || Response.error();
        }
      })
    );
    return;
  }
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

// ---------------------------------------------------------------- push reminders (sent by the send-reminders Edge Function)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'ANGLER';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Today’s dive is open.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || 'angler-daily',
    renotify: false,
    data: { url: data.url || './#daily' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : './#daily', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target).catch(() => null); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
