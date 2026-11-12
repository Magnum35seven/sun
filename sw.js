const CACHE = 'sunray-shell-v3';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './README.md'];
const LIBRARIES = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/@turf/turf@6.5.0/dist/turf.min.js',
  'https://unpkg.com/suncalc@1.9.0/suncalc.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(SHELL);
    await Promise.all(LIBRARIES.map(async url => { try { const response = await fetch(url); if (response.ok) await cache.put(url, response); } catch (_) { /* Online CDN remains available when connected. */ } }));
    await self.skipWaiting();
  }));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (url.hostname.endsWith('.tile.openstreetmap.org') || url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request);
      try { const response = await fetch(request); if (response.ok) cache.put(request, response.clone()); return response; }
      catch (_) { return cached || Response.error(); }
    }));
    return;
  }
  if (LIBRARIES.includes(request.url)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
