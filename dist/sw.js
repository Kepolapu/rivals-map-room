'use strict';

const CACHE_PREFIX = `rivals-map-room-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'maps.json', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES.map((path) => new Request(scopeUrl(path), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const cache = await caches.open(CACHE_NAME);
    const maps = await getCatalog(cache);
    const previous = keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
    for (const key of previous) {
      const oldCache = await caches.open(key);
      let preserved = true;
      for (const map of maps) {
        const url = scopeUrl(map.src);
        if (await cache.match(url)) continue;
        const response = await oldCache.match(url);
        if (!response) continue;
        try { await cache.put(url, response); }
        catch { preserved = false; }
      }
      // Keep the previous cache if device storage prevented any existing map from migrating.
      if (preserved) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const pathname = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (pathname.startsWith('maps/') || pathname.startsWith('icons/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  if (request.mode === 'navigate' || SHELL_FILES.some((file) => scopeUrl(file) === url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request) || (request.mode === 'navigate' ? await cache.match(scopeUrl('index.html')) : undefined);
        if (cached) return cached;
        throw error;
      }
    })());
  }
});

async function getCatalog(cache, refresh = false) {
  const url = scopeUrl('maps.json');
  let response;
  if (refresh) {
    try {
      response = await fetch(url, { cache: 'no-store' });
      if (response.ok) await cache.put(url, response.clone());
      else response = undefined;
    } catch { /* An existing catalog can resume a partial offline download. */ }
  }
  if (!response) response = await cache.match(url);
  if (!response) throw new Error('The map catalog is not saved. Reconnect and refresh.');
  const catalog = await response.json();
  if (!Array.isArray(catalog)) throw new Error('The map catalog is unavailable.');
  return catalog.filter((map) => map.available && typeof map.src === 'string' && /^(?:\.\/)?maps\/[a-z0-9_-]+\.webp$/i.test(map.src));
}

async function offlineStatus(cache, catalog) {
  const maps = catalog || await getCatalog(cache);
  const saved = await Promise.all(maps.map((map) => cache.match(scopeUrl(map.src))));
  const shell = await Promise.all(SHELL_FILES.map((path) => cache.match(scopeUrl(path))));
  const cached = saved.filter(Boolean).length;
  return { type: 'COMPLETE', cached, total: maps.length, ready: cached === maps.length && shell.every(Boolean) };
}

let downloadInProgress = null;
self.addEventListener('message', (event) => {
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      if (event.data.type === 'OFFLINE_STATUS') {
        port.postMessage(await offlineStatus(cache));
        return;
      }
      if (event.data.type !== 'CACHE_LIBRARY') return;
      if (downloadInProgress) {
        await downloadInProgress;
        port.postMessage(await offlineStatus(cache));
        return;
      }
      downloadInProgress = (async () => {
        const maps = await getCatalog(cache, true);
        // Automatic downloads also repair shell entries evicted by device storage.
        await Promise.all(SHELL_FILES.map(async (path) => {
          const url = scopeUrl(path);
          if (await cache.match(url)) return;
          try {
            const response = await fetch(url, { cache: 'no-store' });
            if (response.ok) await cache.put(url, response);
          } catch { /* Final status remains incomplete until every shell file is present. */ }
        }));
        let next = 0;
        let cached = 0;
        port.postMessage({ type: 'PROGRESS', cached, total: maps.length });
        const worker = async () => {
          while (next < maps.length) {
            const map = maps[next++];
            const url = scopeUrl(map.src);
            let response = await cache.match(url);
            if (!response) {
              try {
                response = await fetch(url, { cache: 'no-store' });
                if (response.ok) await cache.put(url, response.clone());
                else response = undefined;
              } catch { response = undefined; }
            }
            if (response) cached++;
            port.postMessage({ type: 'PROGRESS', cached, total: maps.length });
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, maps.length) }, worker));
        return offlineStatus(cache, maps);
      })();
      try { port.postMessage(await downloadInProgress); }
      finally { downloadInProgress = null; }
    } catch (error) {
      downloadInProgress = null;
      port.postMessage({ type: 'COMPLETE', error: error.message || 'The offline download could not finish.' });
    }
  })());
});
