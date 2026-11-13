// Service worker: makes OpenTactics installable and playable offline (against the
// computer or on one screen; online play still needs a connection).
//
// Code and data are fetched from the network first, so a new deploy shows up on the
// next load, and fall back to the cache when offline. Art, sounds and fonts rarely
// change and are served from the cache first. The map server API, other sites
// (remote maps, the PeerJS broker) and non-GET requests are never touched.

const BUILD = '__BUILD__';            // replaced with the commit id when deploying
const CACHE = `opentactics-${BUILD}`;
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'opentactics.wasm',
  'js/main.js', 'js/game.js', 'js/art.js', 'js/engine.js', 'js/editor.js', 'js/net.js', 'js/sound.js',
  'vendor/peerjs.min.js', 'rules/default.json', 'rules/blitz.json', 'maps/index.json',
  'assets/tiles.png', 'assets/kenney-mini.ttf', 'assets/kenney-mini-square-mono.ttf',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png',
  ...['bong_001', 'click_002', 'confirmation_001', 'drop_002', 'error_004', 'glitch_002',
    'maximize_006', 'scratch_002', 'select_003', 'tick_001'].map(s => `assets/${s}.ogg`),
];
const STATIC = /\.(png|ogg|ttf)$/;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    // Every bundled map, so the whole map list works offline.
    try {
      const index = await (await fetch('maps/index.json')).json();
      await cache.addAll(index.map(m => `maps/${m.id}.json`));
      const missions = await (await fetch('missions/index.json')).json();
      await cache.addAll(['missions/index.json', ...missions.map(m => `missions/${m.id}.json`), 'js/stats.js']);
    } catch { /* they will be cached as they are used */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('opentactics-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (req.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname.startsWith(`${scope.pathname}api/`)) return;
  event.respondWith(STATIC.test(url.pathname) ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  return hit || refresh(req);
}

async function networkFirst(req) {
  try {
    return await refresh(req);
  } catch (err) {
    // Pages are opened with query strings (?map=…, ?join=…); any copy of the page will do.
    const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    throw err;
  }
}

async function refresh(req) {
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
}
