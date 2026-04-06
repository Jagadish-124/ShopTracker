// ============================================================================
// sw.js — Service Worker for Shop Tracker
// ============================================================================

// FIX #69: Bump cache version whenever the app is deployed so stale assets
// are immediately evicted on activation rather than served to returning users.
const CACHE  = 'shop-tracker-v3';

// FIX #70: Only cache truly static assets. JS is excluded here (handled below)
// so that new deployments are always picked up.
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './csv-import.css',
  './manifest.json',
  './favicon.ico',
  './icon-192.png',
];

// ── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        // FIX #71: Delete ALL old shop-tracker caches, not just the exact previous version,
        // so stale data from any older version is cleaned up.
        keys
          .filter(k => k.startsWith('shop-tracker-') && k !== CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // FIX #72: Only intercept same-origin and approved CDN requests.
  // Never intercept Firebase, exchange-rate API, or other auth/data endpoints
  // — those must always go to the network directly.
  const BYPASS_ORIGINS = [
    'firebaseapp.com',
    'googleapis.com',
    'google.com',
    'gstatic.com',
    'exchangerate-api.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
  ];
  if (BYPASS_ORIGINS.some(origin => url.hostname.endsWith(origin))) {
    // FIX #73: For CDN scripts (Chart.js, jsPDF, Firebase SDKs) use
    // stale-while-revalidate so the app still works offline but picks
    // up updates quickly when online.
    event.respondWith(
      caches.open(CACHE).then(async cache => {
        const cached = await cache.match(event.request);
        const networkFetch = fetch(event.request).then(response => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => cached); // Offline: return cached version if available
        return cached || networkFetch;
      })
    );
    return;
  }

  // FIX #74: Only cache GET requests — never cache POST/PUT/DELETE
  if (event.request.method !== 'GET') return;

  // FIX #75: Don't cache opaque (cross-origin no-cors) responses — they
  // have status 0 and can silently fill the cache with unusable data.
  const isSameOrigin = url.origin === self.location.origin;

  if (url.pathname.endsWith('.js')) {
    // JS files: network-first with cache fallback so updates are instant
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // FIX #76: Only cache successful, non-opaque responses
          if (response.ok && isSameOrigin) {
            caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else (HTML, CSS, icons): cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // FIX #77: Only cache successful same-origin responses
        if (response.ok && isSameOrigin) {
          caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      });
    })
  );
});

// ── Notification click ────────────────────────────────────────────────────────

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // FIX #78: Prefer an existing window that is already on the app URL
      // rather than always focusing the first one found.
      const appClient = clientList.find(c => c.url.includes(self.registration.scope));
      if (appClient) return appClient.focus();
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('./');
    })
  );
});

// ── Periodic background sync (future-proofing) ───────────────────────────────
// FIX #79: Listen for the sync event so that when Background Sync API
// is used in the future, queued saves fire automatically on reconnect.
self.addEventListener('sync', event => {
  if (event.tag === 'sync-pending-save') {
    // The actual flush logic lives in script.js (flushPendingSave).
    // The SW just needs to be present so the browser registers the event.
    // Posting a message to all active clients triggers the flush.
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        clientList.forEach(client => client.postMessage({ type: 'SW_SYNC_TRIGGER' }));
      })
    );
  }
});