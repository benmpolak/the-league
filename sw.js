// The League service worker — strictly NETWORK-FIRST, everywhere.
// The cache is an emergency generator: it only ever answers when the network
// fails (tunnels, trains, draft-night Wi-Fi). While online, every request goes
// to the network, so the stale-build watchdog in app.js stays authoritative
// and a deploy is live on the very next load — installed app or not.
//
// Cache Storage is shared across the whole benmpolak.github.io origin, not per
// worker scope — cache names are prefixed with this worker's scope and cleanup
// only ever touches that prefix, so the beta can't wipe the real site's cache
// (or the DJ archive's, or anyone else's).
const PREFIX = 'tl-shell:' + new URL(self.registration.scope).pathname + ':';
const CACHE = PREFIX + 'v6';
const LEGACY = ['the-league-shell-v1', 'the-league-shell-v2']; // pre-prefix names from this worker's earlier builds
const SHELL = [
  './', './index.html', './css/style.css',
  './js/hostguard.js', './js/data.js', './js/history25.js', './js/lore.js',
  './js/engine.js', './js/club-media.js', './js/cunthanger.js', './js/app.js', './js/gazette.js', './js/podcast.js', './js/sync.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
  // the sandbox's own name and crest, so the practice app is still telling
  // itself apart from the real one on a dead train
  './manifest-sandbox.json', './icons/icon-sandbox-192.png', './icons/icon-sandbox-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys
      .filter(key => (key.startsWith(PREFIX) && key !== CACHE) || LEGACY.includes(key))
      .map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return; // HEAD probes (build watchdog) and writes pass straight through
  const url = new URL(request.url);
  // same-origin shell + data, plus the Firebase SDK from gstatic (needed for a cold offline start)
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && url.hostname !== 'www.gstatic.com') return;
  // one cache entry per path: cache-busting queries (data/stats.json?t=...)
  // would otherwise never match offline and grow the cache without bound
  const cacheKey = sameOrigin ? url.origin + url.pathname : request.url;

  event.respondWith(fetch(request).then(response => {
    if (response.ok || response.type === 'opaque') {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(cacheKey, copy));
    }
    return response;
  }).catch(() =>
    caches.match(cacheKey, { ignoreSearch: true }).then(hit =>
      hit || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  ));
});
