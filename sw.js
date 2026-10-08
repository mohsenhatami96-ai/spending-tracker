/* Spending Tracker service worker: caches the app shell for full offline use. Data is never sent anywhere. */
const VERSION = '76c52dddf0';
const CACHE = 'spending-tracker-' + VERSION;
const SHELL = ["./","./index.html","./manifest.webmanifest","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-192.png","./icons/icon-maskable-512.png","./icons/favicon-32.png"];
self.addEventListener('install', e => {
  // no skipWaiting here: the page shows "A new version is available" and activates it on request
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('spending-tracker-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {   // app page: cache first (works offline), any path inside the scope gets index.html
    e.respondWith(caches.open(CACHE).then(c => c.match('./index.html')).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
