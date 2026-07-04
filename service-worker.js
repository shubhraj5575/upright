// service-worker.js — hardened offline + installability.
//
// Strategy: precache the (small) app shell on install so the app opens offline
// immediately. Everything else same-origin — including the larger vendored
// TF.js + MoveNet model — is runtime-cached on first use (cache-first), so the
// camera works offline once it's been used once, without forcing a multi-MB
// download on users who never open it.
//
// Bump CACHE_VERSION whenever shipping changed assets to retire old caches.

const CACHE_VERSION = 'upright-v3';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/icons/icon.svg',
  'styles/tokens.css',
  'styles/base.css',
  'styles/components.css',
  'styles/app.css',
  'js/app.js',
  'js/router.js',
  'js/core/events.js',
  'js/core/dates.js',
  'js/core/schema.js',
  'js/core/store.js',
  'js/core/backup.js',
  'js/core/ui.js',
  'js/core/notify.js',
  'js/core/theme.js',
  'js/core/charts.js',
  'js/core/icons.js',
  'js/core/flare.js',
  'js/core/insights.js',
  'js/core/review.js',
  'js/core/csv.js',
  'js/core/body-regions.js',
  'js/core/nutrition.js',
  'js/modules/dashboard.js',
  'js/modules/pain-trends.js',
  'js/modules/goals.js',
  'js/modules/posture-reminders.js',
  'js/modules/posture-camera.js',
  'js/modules/posture-heuristic.js',
  'js/modules/posture-score.js',
  'js/modules/cam-pipeline.js',
  'js/modules/cam-overlay.js',
  'js/modules/cam-session.js',
  'js/modules/alert-ladder.js',
  'js/modules/cam-diagnostics.js',
  'js/modules/settings.js',
  'js/modules/onboarding.js',
  'js/modules/wellbeing.js',
  'js/modules/insights.js',
  'js/modules/flare.js',
  'js/modules/body-map.js',
  'js/modules/breathing.js',
  'js/modules/ergo-sleep-guide.js',
  'js/modules/exercises.js',
  'js/modules/meal-plan.js',
  'js/modules/meal-log.js',
  'js/modules/report.js',
  'data/ergo-sleep-content.json',
  'data/exercises-starter.json',
  'data/foods-starter.json',
  'data/meal-plan-starter.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // {cache:'reload'} bypasses the HTTP cache so a version bump always pulls
    // FRESH assets — otherwise the SW could re-cache stale files and serve old
    // code indefinitely. Resilient: one missing file shouldn't fail install.
    await Promise.all(SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only handle same-origin

  // SPA navigations always resolve to the shell (hash router lives in index.html).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (_) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Cache-first for everything else, populating the cache on first fetch.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});
