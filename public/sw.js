// Service worker: deixa a página do botão SOS abrindo mesmo sem internet.
const CACHE = 'farol-v2';
const ARQUIVOS = [
  '/sos.html', '/repassar.html', '/shared/protocol.js', '/manifest.webmanifest',
  '/vendor/qrcode.js', '/icone.svg',
];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // API sempre vai para a rede
  e.respondWith(
    fetch(e.request)
      .then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
