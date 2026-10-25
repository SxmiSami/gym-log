// Offline-Cache: Die App lädt sofort aus dem Cache (auch ohne Empfang)
// und holt sich im Hintergrund die neueste Version für den nächsten Start.
// Bei jeder neuen Version VERSION erhöhen.

const VERSION = '1.0.3';
const CACHE = 'gymlog-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/sync.js',
  './js/timer.js',
  './js/progression.js',
  './js/charts.js',
  './js/icons.js',
  './js/util.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' → beim Update wirklich frische Dateien holen, nicht aus dem Browser-Cache
  event.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('gymlog-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // GitHub-API und alles Fremde nicht anfassen
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req)
      .then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    return (await network) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }));
});
