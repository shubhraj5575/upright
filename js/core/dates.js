// dates.js — day keys and streak math. Pure, no DOM, no storage.
//
// Day keys are 'YYYY-MM-DD' derived from LOCAL time. We never use
// Date#toISOString here: that returns a UTC date, which silently rolls to the
// "wrong" day for any user not on UTC during the late-evening / early-morning
// hours. Every key in the app must agree on the same local calendar day.

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** Local 'YYYY-MM-DD' for a Date (defaults to now). */
export function toKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Alias — reads better at call sites that mean "what day is it". */
export function todayKey(date = new Date()) {
  return toKey(date);
}

/** Parse a 'YYYY-MM-DD' key into a Date at LOCAL midnight. */
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d); // local time, 00:00:00
}

/**
 * Add n calendar days to a key, returning a new key. Uses local date
 * components so it stays correct across DST transitions (no hour drift).
 */
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return toKey(new Date(y, m - 1, d + n));
}

/** Whole calendar days between two keys: aKey - bKey (positive if a is later). */
export function diffDays(aKey, bKey) {
  const [ay, am, ad] = aKey.split('-').map(Number);
  const [by, bm, bd] = bKey.split('-').map(Number);
  // Compare via UTC of the local Y/M/D to avoid DST hour artifacts.
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((a - b) / 86400000);
}

/** How many days ago `key` was, relative to today (0 = today). */
export function daysAgo(key, today = todayKey()) {
  return diffDays(today, key);
}

export function isToday(key, today = todayKey()) {
  return key === today;
}

/** Human label for a key: "Today", "Yesterday", else e.g. "Mon, Jun 16". */
export function formatHuman(key, today = todayKey()) {
  const delta = daysAgo(key, today);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Yesterday';
  const d = parseKey(key);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * Current streak ending at/near `today`, counting the number of days actually
 * logged within the surviving run.
 *
 * Grace rule (the recovery-app kindness): an isolated single missed day is
 * forgiven, but `grace + 1` consecutive missed days break the streak. With the
 * default grace = 1:
 *   - {today, -1, -3}        → 3  (the single gap at -2 is forgiven)
 *   - {today, -1, -4, -5}    → 2  (two consecutive misses at -2,-3 break it)
 *   - {today, -2, -4, -6}    → 4  (every-other-day survives; each gap is single)
 *   - {-1, -2, -3} (no today)→ 3  (a not-yet-logged today does not reset it)
 *   - {-2, -3} (no today/-1) → 0  (two missed days up to now → streak gone)
 *
 * @param {string[]} keys  logged day keys (any order, duplicates ok)
 * @param {string}   today today's key
 * @param {{grace?: number}} [opts]
 * @returns {number}
 */
export function computeStreak(keys, today = todayKey(), opts = {}) {
  const grace = opts.grace == null ? 1 : opts.grace;
  const set = new Set(keys);
  if (set.size === 0) return 0;

  let streak = 0;
  let consecutiveMissed = 0;
  let cursor = today;

  // Walk backward from today. A missed day increments a counter; the streak
  // breaks once that counter exceeds the grace allowance. A logged day resets
  // the counter and extends the streak. The loop always terminates because
  // once the cursor passes the earliest logged day, misses accumulate to break.
  for (;;) {
    if (set.has(cursor)) {
      streak += 1;
      consecutiveMissed = 0;
    } else {
      consecutiveMissed += 1;
      if (consecutiveMissed > grace) break;
    }
    cursor = addDays(cursor, -1);
  }

  return streak;
}
