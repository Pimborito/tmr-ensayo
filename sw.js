const CACHE = 'tenis-mesa-shell-v1.19.9';
const FILES = ['./', './index.html', './styles.css?v=1.19.9', './app.js?v=1.19.9', './app-theme.css?v=1.19.9', './assets/fonts/tmr-sans-regular.woff', './assets/fonts/tmr-sans-bold.woff', './manifest.json?v=1.19.9', './assets/escudo-tmr.jpg', './assets/escudo-tmr-transparente.png', './assets/tmr-icon-192.png', './assets/tmr-icon-512.png'];
const SHELL = new Set(FILES.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(FILES.map(async path => {
      const request = new Request(new URL(path, self.registration.scope), {cache: 'reload'});
      const response = await fetch(request);
      if (!response.ok || response.redirected) throw new Error('No se pudo descargar la aplicación');
      await cache.put(request, response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(name => name.startsWith('tenis-mesa-shell-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode !== 'navigate' && !SHELL.has(request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(request, {cache: 'no-store', signal: controller.signal});
      if (response.ok && !response.redirected) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request) || (request.mode === 'navigate' ? await cache.match(new URL('./index.html', self.registration.scope).href) : undefined);
      if (cached) return cached;
      throw error;
    } finally { clearTimeout(timer); }
  })());
});
