// alert-ladder.js — PURE escalation logic for slouch alerts. The camera shell
// calls step() every tick with the current posture state; this returns which
// rung (if any) should fire *this* tick. Escalation:
//
//   poor ≥ 4s   → 'status'  (inline status only — no interruption)
//   poor ≥ 12s  → 'toast'   (in-app toast)
//   poor ≥ 30s  → 'notify'  (OS notification + optional chime)
//   still poor  → re-'notify' every 2 min
//
// The ladder freezes (nothing above 'status') while snoozed, away, paused,
// out of active hours, or during a flare-up — monitoring continues, nagging
// doesn't. Recovering to good posture resets the ladder.

export const STATUS_MS = 4000;
export const TOAST_MS = 12000;
export const NOTIFY_MS = 30000;
export const RENOTIFY_MS = 120000;

export const SNOOZE_OPTIONS_MIN = [5, 15, 60];

export function createLadder() {
  return {
    poorSince: 0, // timestamp the current poor stretch began (0 = not poor)
    statusFired: false,
    toastFired: false,
    lastNotifyAt: 0,
  };
}

/**
 * Advance the ladder one tick.
 * @param {object} l  from createLadder() — treated immutably
 * @param {{ state:'good'|'poor'|'away'|'paused', now:number,
 *           snoozedUntil?:number|null, frozen?:boolean }} input
 *   frozen: cap at 'status' (out of active hours, flare mode, …)
 * @returns {{ ladder:object, fire:'status'|'toast'|'notify'|null, heldMs:number }}
 */
export function stepLadder(l, input) {
  const { state, now, snoozedUntil = null, frozen = false } = input;

  // Anything but a live "poor" resets the ladder.
  if (state !== 'poor') {
    const cleared = l.poorSince !== 0 || l.statusFired || l.toastFired || l.lastNotifyAt !== 0;
    return { ladder: cleared ? createLadder() : l, fire: null, heldMs: 0 };
  }

  const next = { ...l };
  if (!next.poorSince) next.poorSince = now;
  const heldMs = now - next.poorSince;
  const snoozed = snoozedUntil != null && now < snoozedUntil;

  let fire = null;
  if (heldMs >= STATUS_MS && !next.statusFired) {
    next.statusFired = true;
    fire = 'status';
  }
  // Rungs above 'status' respect snooze and freeze.
  if (!snoozed && !frozen) {
    if (heldMs >= TOAST_MS && !next.toastFired) {
      next.toastFired = true;
      fire = 'toast';
    }
    if (heldMs >= NOTIFY_MS && (next.lastNotifyAt === 0 || now - next.lastNotifyAt >= RENOTIFY_MS)) {
      next.lastNotifyAt = now;
      fire = 'notify';
    }
  }
  return { ladder: next, fire, heldMs };
}

/** Snooze end timestamp for a chosen option. */
export function snoozeUntil(now, minutes) {
  return now + minutes * 60000;
}
