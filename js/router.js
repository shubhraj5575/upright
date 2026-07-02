// router.js — a tiny hash router. No history API, no build step: routes are
// `#/<name>` so the app works from a plain static server and survives reloads.
// Each route maps to a module's init(mountEl); unbuilt routes fall through to a
// friendly placeholder so the shell is always navigable during development.

import { clear } from './core/ui.js';
import { emit } from './core/events.js';

const routes = new Map(); // path -> { init, title }
let fallback = null; // (mountEl, path) => void
let defaultPath = 'dashboard';
let mountEl = null;
let navEl = null;
let started = false;
let currentCleanup = null; // teardown returned by the active view's init()

/** Register a route. `init(mountEl)` renders the view into the mount element. */
export function register(path, init, title) {
  routes.set(path, { init, title: title || path });
  return { register };
}

/** What to render when no route matches (e.g. not-yet-built modules). */
export function setFallback(fn) {
  fallback = fn;
}

export function setDefault(path) {
  defaultPath = path;
}

/** Parse the current hash into a bare path, e.g. '#/pain?x=1' -> 'pain'. */
export function currentPath() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  return raw.split('?')[0].split('/')[0] || defaultPath;
}

export function navigate(path) {
  location.hash = '#/' + path;
}

/**
 * Active-state for every nav surface at once: any element with [data-nav]
 * (top nav links, tab-bar items, More sheet entries) lights up when its
 * path — or one of its comma-separated paths — matches.
 */
function updateNav(path) {
  for (const link of document.querySelectorAll('[data-nav]')) {
    const paths = (link.dataset.nav || '').split(',').map((p) => p.trim());
    const active = paths.includes(path);
    link.classList.toggle('is-active', active);
    if (active && link.tagName === 'A') link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let firstRender = true;

function renderInto(path, route) {
  // Tear down the previous view (unsubscribe store listeners, clear timers)
  // before swapping, so repeated navigation can't leak subscriptions.
  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (_) { /* ignore */ }
  }
  currentCleanup = null;

  clear(mountEl);
  mountEl.scrollTop = 0;
  window.scrollTo(0, 0);

  if (route) {
    document.title = `${route.title} · Upright`;
    try {
      const teardown = route.init(mountEl);
      if (typeof teardown === 'function') currentCleanup = teardown;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[router] route "${path}" failed to render:`, err);
      mountEl.textContent = 'Something went wrong rendering this view.';
    }
  } else if (fallback) {
    document.title = 'Upright';
    fallback(mountEl, path);
  } else {
    mountEl.textContent = `No view registered for "${path}".`;
  }
}

function render() {
  const path = currentPath();
  const route = routes.get(path);
  const finish = () => {
    updateNav(path);
    if (!firstRender) {
      // Move focus to the new view for keyboard/SR users (skip initial load —
      // stealing focus at boot is hostile).
      mountEl.focus({ preventScroll: true });
    }
    firstRender = false;
    emit('route:change', { path });
  };

  // Cross-fade route swaps via the View Transitions API where available;
  // otherwise a light CSS entrance on the mount element.
  if (!firstRender && !reducedMotion() && typeof document.startViewTransition === 'function') {
    document.startViewTransition(() => renderInto(path, route)).finished.finally(finish);
  } else {
    renderInto(path, route);
    if (!firstRender && !reducedMotion()) {
      mountEl.classList.remove('view-enter');
      void mountEl.offsetWidth; // restart the animation
      mountEl.classList.add('view-enter');
    }
    finish();
  }
}

/** Begin routing. Call once after routes are registered. */
export function start(mount, nav) {
  mountEl = mount;
  navEl = nav || null;
  if (!started) {
    window.addEventListener('hashchange', render);
    started = true;
  }
  if (!location.hash) {
    // Set the default without adding a history entry on first load.
    location.replace('#/' + defaultPath);
  }
  render();
}
