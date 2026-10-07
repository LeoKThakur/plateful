// Offline support: the app shell and food database are cached; everything else is network-first.
const VERSION = 'plateful-v2';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/store.js', 'js/nutrition.js', 'js/foods.js', 'js/scanner.js', 'js/charts.js',
  'data/fndds.json', 'vendor/zxing.min.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // food APIs go straight to the network
  // Stale-while-revalidate: open instantly from cache, pick up new versions in the background.
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then((r) => {
      if (r.ok) cache.put(e.request, r.clone());
      return r;
    }).catch(() => cached);
    return cached || network;
  }));
});
