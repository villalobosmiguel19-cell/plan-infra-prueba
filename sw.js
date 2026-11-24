/* Service Worker · PLAN INFRA – PRUEBA MÓVIL
 * Guarda en caché solo la "carcasa" de la aplicación para que abra sin conexión.
 * Los envíos al servidor (POST a Apps Script) NUNCA se responden desde caché. */
var VERSION = 'pi-prueba-v1';
var ARCHIVOS = [
  './', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ARCHIVOS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (claves) {
    return Promise.all(claves.filter(function (k) { return k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Red primero (para recibir actualizaciones); caché si no hay conexión.
  e.respondWith(
    fetch(req).then(function (resp) {
      var copia = resp.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copia); });
      return resp;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match('index.html'); });
    })
  );
});
