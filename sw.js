// The League service worker — strictly NETWORK-FIRST, everywhere.
// The cache is an emergency generator: it only ever answers when the network
// fails (tunnels, trains, draft-night Wi-Fi). While online, every request goes
// to the network, so the stale-build watchdog in app.js stays authoritative
// and a deploy is live on the very next load — installed app or not.
const CACHE = 'the-league-shell-v2';
const SHELL = [
  './', './index.html', './css/style.css',
  './js/hostguard.js', './js/data.js', './js/history25.js', './js/lore.js',
  './js/engine.js', './js/app.js', './js/sync.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return; // HEAD probes (build watchdog) and writes pass straight through
  const url = new URL(request.url);
  // same-origin shell + data, plus the Firebase SDK from gstatic (needed for a cold offline start)
  const cacheable = url.origin === self.location.origin || url.hostname === 'www.gstatic.com';
  if (!cacheable) return;

  event.respondWith(fetch(request).then(response => {
    if (response.ok || response.type === 'opaque') {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() =>
    caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then(hit =>
      hit || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  ));
});
