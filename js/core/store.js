// store.js — the only thing that touches localStorage. All keys are namespaced
// `upright.v1.*`. Every mutation emits exactly one `store:change` on the shared
// event bus; store.subscribe() is sugar that filters those events by key, so
// there is a single notification path (no divergent store-vs-bus channels).

import { emit, on } from './events.js';
import { KEYS, defaults, defaultFor } from './schema.js';

export const NS = 'upright.v1.';
const fullKey = (key) => NS + key;

const CHANGE = 'store:change'; // payload: { key, value }
const REPLACE = 'store:replace'; // payload: { keys } — full dataset swap

// localStorage can throw (private mode / disabled / quota). We don't want the
// whole app to die over a write failure, so reads/writes are guarded.
function rawGet(key) {
  try {
    return localStorage.getItem(fullKey(key));
  } catch (_) {
    return null;
  }
}
function rawSet(key, str) {
  try {
    localStorage.setItem(fullKey(key), str);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[store] failed to write "${key}":`, err);
    return false;
  }
}
function rawRemove(key) {
  try {
    localStorage.removeItem(fullKey(key));
  } catch (_) {
    /* ignore */
  }
}

/** True if a key has ever been written (distinguishes "absent" from "empty"). */
export function has(key) {
  return rawGet(key) !== null;
}

/**
 * Read a key. Falls back to the provided default, or the schema default for
 * that key, so callers always get a usable value even before seeding.
 */
export function get(key, fallback) {
  const raw = rawGet(key);
  if (raw === null) {
    return fallback !== undefined ? fallback : defaultFor(key);
  }
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback !== undefined ? fallback : defaultFor(key);
  }
}

/** Write a key and emit one change event. */
export function set(key, value) {
  rawSet(key, JSON.stringify(value));
  emit(CHANGE, { key, value });
  return value;
}

/** Read-modify-write. `fn` receives the current value and returns the next. */
export function update(key, fn) {
  const next = fn(get(key));
  return set(key, next);
}

/** The whole dataset as one object, keyed by schema key. */
export function all() {
  const out = {};
  for (const key of KEYS) out[key] = get(key);
  return out;
}

/**
 * Replace the entire dataset (used by backup "Replace" import and reset).
 * Writes every schema key, emitting one change per key plus a single REPLACE
 * summary event for views that prefer a full re-render.
 */
export function replaceAll(dataset) {
  const safe = dataset && typeof dataset === 'object' ? dataset : {};
  for (const key of KEYS) {
    const value = key in safe ? safe[key] : defaultFor(key);
    rawSet(key, JSON.stringify(value));
    emit(CHANGE, { key, value });
  }
  emit(REPLACE, { keys: KEYS });
}

/** Remove a key (resets it to its schema default on next read). */
export function remove(key) {
  rawRemove(key);
  emit(CHANGE, { key, value: defaultFor(key) });
}

/** Wipe all app keys — used by guarded "Reset all" in Settings. */
export function clearAll() {
  for (const key of KEYS) rawRemove(key);
  emit(REPLACE, { keys: KEYS });
}

/**
 * Subscribe to changes. Sugar over the bus:
 *  - subscribe('*', cb)      → every change, cb({ key, value })
 *  - subscribe('painLog', cb)→ only that key's changes, cb(value)
 * Returns an unsubscribe function.
 */
export function subscribe(key, cb) {
  if (key === '*') {
    return on(CHANGE, cb);
  }
  return on(CHANGE, (payload) => {
    if (payload.key === key) cb(payload.value, payload);
  });
}

/** Subscribe to full-dataset swaps (import-replace / reset). */
export function onReplace(cb) {
  return on(REPLACE, cb);
}

/**
 * First-run seeding. Writes a full default dataset ONLY when `meta` is absent,
 * so a reload (or an app already in use) never clobbers existing data. `now`
 * is injectable for tests; defaults to the real clock.
 */
export function ensureSeeded(now = new Date().toISOString()) {
  if (has('meta')) return false;
  const seed = defaults(now);
  for (const key of KEYS) rawSet(key, JSON.stringify(seed[key]));
  emit(REPLACE, { keys: KEYS });
  return true;
}
