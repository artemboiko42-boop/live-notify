const CACHE_NAME = 'live-notify-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Я в эфире 🔴';
  const options = {
    body: data.body || 'Подключайся прямо сейчас',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: 'live-now',
    renotify: true,
    silent: false,
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Открыть эфир' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = allClients.find((client) => client.url.includes(self.location.origin));
    if (existing) {
      existing.focus();
      existing.navigate(url);
      return;
    }
    await clients.openWindow(url);
  })());
});
