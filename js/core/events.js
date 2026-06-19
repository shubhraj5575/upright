// events.js — tiny synchronous pub/sub bus. One shared instance for the whole
// app. This is the single notification path: store.js emits through it, and
// store.subscribe() is just sugar that filters bus events by key. Modules talk
// to each other only through this bus (per the module contract), never by
// reaching into each other's storage.

const channels = new Map(); // event name -> Set<callback>

/**
 * Subscribe to an event. Returns an unsubscribe function.
 * @param {string} event
 * @param {(payload:any)=>void} cb
 * @returns {() => void}
 */
export function on(event, cb) {
  let set = channels.get(event);
  if (!set) {
    set = new Set();
    channels.set(event, set);
  }
  set.add(cb);
  return () => off(event, cb);
}

/** Subscribe for a single firing, then auto-unsubscribe. */
export function once(event, cb) {
  const unsub = on(event, (payload) => {
    unsub();
    cb(payload);
  });
  return unsub;
}

/** Remove a specific listener. */
export function off(event, cb) {
  const set = channels.get(event);
  if (set) {
    set.delete(cb);
    if (set.size === 0) channels.delete(event);
  }
}

/**
 * Emit an event to all listeners. Listeners are snapshotted first so a handler
 * that subscribes/unsubscribes during dispatch can't corrupt this run. A throw
 * in one listener is isolated so it can't starve the others.
 * @param {string} event
 * @param {any} [payload]
 */
export function emit(event, payload) {
  const set = channels.get(event);
  if (!set || set.size === 0) return;
  for (const cb of [...set]) {
    try {
      cb(payload);
    } catch (err) {
      // Don't let one bad listener break the rest of the app.
      // eslint-disable-next-line no-console
      console.error(`[events] listener for "${event}" threw:`, err);
    }
  }
}

/** Remove every listener for an event (or all events if omitted). Mainly tests. */
export function clear(event) {
  if (event == null) channels.clear();
  else channels.delete(event);
}
