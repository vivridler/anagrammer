// Offline support for the app shell.
const CACHE = 'crossword-v10';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/importer.js', 'js/vision.js', 'js/puzzle.js', 'js/store.js', 'js/ocr.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'icons/icon-maskable.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first so updates show up straight away; the cache is the offline fallback.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Always check with the server (cheap if unchanged) rather than trusting the browser's
      // HTTP cache, which GitHub Pages lets keep files for 10 minutes.
      const res = await fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      if (cached) return cached;
      throw err;
    }
  })());
});
