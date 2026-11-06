/* Spending Tracker service worker: caches the app shell for full offline use. Data is never sent anywhere. */
const VERSION = 'cda4fed6b6';
const CACHE = 'spending-tracker-' + VERSION;
const SHELL = ["./","./index.html","./manifest.webmanifest","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-192.png","./icons/icon-maskable-512.png","./icons/favicon-32.png","./styles.css","./app.js","./domain/categories.js","./domain/categorize.js","./domain/dates.js","./domain/dict.js","./domain/local.js","./domain/money.js","./domain/parse-csv.js","./domain/plan-defaults.js","./domain/ports.js","./domain/rules.js","./domain/state.js","./domain/util.js","./storage/localStorage.js","./ui/boot.js","./ui/budgets.js","./ui/dashboard.js","./ui/dom.js","./ui/plan-ui.js","./ui/review.js","./ui/settings.js","./ui/transactions.js"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('spending-tracker-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(c => c.match('./index.html')).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
