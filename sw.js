/* Service worker de Linderos GNSS.
 * Guarda la aplicación en el dispositivo para usarla sin internet.
 * Al publicar cambios, sube VERSION (p. ej. 'v2') para que los equipos se actualicen.
 */
const VERSION = 'v1';
const CACHE = 'linderos-' + VERSION;

const ARCHIVOS = [
  './',
  './index.html',
  './css/estilo.css',
  './js/core.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// Opcional: SheetJS para Excel sin internet. Si no existe, se ignora sin error.
const OPCIONALES = ['./libs/xlsx.full.min.js'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ARCHIVOS);
    await Promise.all(OPCIONALES.map(u => fetch(u).then(r => r.ok && cache.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter(k => k.startsWith('linderos-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Primero caché (funciona offline); si no está, va a la red y lo guarda.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const enCache = await cache.match(event.request, { ignoreSearch: true });
    if (enCache) return enCache;
    try {
      const red = await fetch(event.request);
      if (red.ok && new URL(event.request.url).origin === self.location.origin) {
        cache.put(event.request, red.clone());
      }
      return red;
    } catch (e) {
      // Sin red y sin caché: devolver la página principal si es una navegación
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      throw e;
    }
  })());
});
