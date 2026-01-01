// Получаем версию из параметра URL (service-worker.js?v=21)
// Если параметра нет, используем дефолт
const params = new URLSearchParams(self.location.search);
const version = params.get('v') || '1';
const cacheName = `calc-editor-v${version}`;

const assets = [
  './',
  'index.html',
  'style.css',
  'main.js',
  // 'manifest.json' - НЕ НУЖЕН, так как генерируется через Blob
  'icons/favicon.ico',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Активировать немедленно
  event.waitUntil(
    caches.open(cacheName)
      .then(cache => {
        console.log(`Кеширование [${cacheName}]`);
        return cache.addAll(assets);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(clients.claim()); // Захватить контроль над вкладками
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== cacheName) {
            console.log('Удаление старого кеша:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});