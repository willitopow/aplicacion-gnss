/* Service worker de Linderos GNSS.
 * La app siempre se carga desde internet (sin caché), así todos los equipos
 * ven la versión más reciente. Este archivo solo permite instalar la app.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Borra cachés antiguas creadas por versiones anteriores
    const claves = await caches.keys();
    await Promise.all(claves.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
