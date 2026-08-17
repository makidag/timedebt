/*
 * Offline shell.
 *
 * Hand-written rather than generated: the app has no runtime network calls, so
 * all this needs to do is keep the shell and the hashed build assets around.
 * Vite fingerprints asset filenames, so cache-first is safe for them; the
 * navigation request is network-first so a new deploy is picked up promptly and
 * still works with the radio off.
 */

const VERSION = 'timedebt-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      // Individually, so one missing file cannot fail the whole install.
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(VERSION);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(VERSION);
          return (
            (await cache.match(request)) ??
            (await cache.match('./index.html')) ??
            new Response('Offline and no cached shell.', { status: 503 })
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(request);
      if (hit) return hit;
      const fresh = await fetch(request);
      if (fresh.ok && fresh.type === 'basic') cache.put(request, fresh.clone());
      return fresh;
    })(),
  );
});
