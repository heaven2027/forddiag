/* Service worker — funcționare offline (aplicația nu are nevoie de internet) */
const CACHE = 'forddiag-v8';
const FILES = ['./', './index.html', './css/style.css', './manifest.json', './icon.svg',
  './js/transport.js', './js/elm327.js', './js/obd.js', './js/ford.js', './js/dtcdb.js',
  './js/knowledge.js', './js/dtcinfo.js','./js/analysis.js', './js/guided.js', './js/trip.js', './js/history.js',
  './js/app.js', './js/app-extra.js', './js/vehicle-history.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// rețea întâi (pentru actualizări), cache dacă nu există conexiune
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
