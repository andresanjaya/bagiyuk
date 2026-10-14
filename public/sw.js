const CACHE = 'bagiyuk-v2';
const SHELL = ['/', '/cafe-hero.webp', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_ASSETS' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter(value => typeof value === 'string' && value.startsWith(`${self.location.origin}/_next/static/`)).slice(0, 200);
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(urls)));
});
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('bagiyuk-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/join/') || url.pathname.startsWith('/split/') || url.searchParams.has('_rsc')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => { if (response.ok) { const clone = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put('/', clone))); } return response; }).catch(() => caches.match('/'))); return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response.ok && (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname))) { const clone = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, clone))); } return response; })));
});
