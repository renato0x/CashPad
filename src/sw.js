const CACHE_NAME = 'cashpad-murs1800';
const APP_SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/firebase-config.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/vendor/firebase-app-compat.js',
  '/vendor/firebase-firestore-compat.js',
  '/vendor/firebase-app-check-compat.js',
  '/vendor/qrcode.min.js',
  '/vendor/html5-qrcode.min.js'
];

const PRECACHE_URLS = APP_SHELL;

function isCacheable(response){
  return response && (
    (response.status === 200 && (response.type === 'basic' || response.type === 'cors')) ||
    response.type === 'opaque'
  );
}

async function fetchAndCache(request){
  const response = await fetch(request);
  if(isCacheable(response)){
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('message', (event) => {
  if(event.data && event.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';

  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: isNavigation });

    if(cached){
      // Serve immediately and refresh without delaying the current request.
      event.waitUntil(fetchAndCache(event.request).catch(() => undefined));
      return cached;
    }

    try{
      return await fetchAndCache(event.request);
    }catch(error){
      if(isNavigation){
        const fallback = await caches.match('/index.html');
        if(fallback) return fallback;
      }
      throw error;
    }
  })());
});
