// Pure-logic tests for js/core/dates.js — the day-key + streak/grace math
// everything in the app depends on. Run headless: `node tests/dates.test.js`
// or open tests/index.html in a browser.

import { createSuite, reportToConsole } from './harness.js';
import {
  todayKey,
  toKey,
  parseKey,
  addDays,
  diffDays,
  daysAgo,
  isToday,
  computeStreak,
} from '../js/core/dates.js';

const s = createSuite('dates');
const { test, eq, deepEq } = s;

// --- local day key (NOT UTC) ---------------------------------------------
// The exact bug the verification hunts: a late-evening local time must yield
// TODAY's key, never tomorrow's (which toISOString().slice(0,10) would give
// for anyone east of UTC).
test('toKey uses local Y/M/D, format YYYY-MM-DD', () => {
  // 2026-06-16 23:30 *local* — constructed via local components.
  const d = new Date(2026, 5, 16, 23, 30, 0);
  eq(toKey(d), '2026-06-16');
});

test('toKey is zero-padded', () => {
  eq(toKey(new Date(2026, 0, 5, 1, 0, 0)), '2026-01-05');
});

test('todayKey(d) matches toKey(d)', () => {
  const d = new Date(2026, 2, 9, 8, 0, 0);
  eq(todayKey(d), toKey(d));
});

// --- parse / arithmetic ---------------------------------------------------
test('parseKey round-trips through toKey', () => {
  eq(toKey(parseKey('2026-06-16')), '2026-06-16');
});

test('parseKey yields local midnight', () => {
  const d = parseKey('2026-06-16');
  eq(d.getHours(), 0);
  eq(d.getFullYear(), 2026);
  eq(d.getMonth(), 5);
  eq(d.getDate(), 16);
});

test('addDays forward and backward, across month boundary', () => {
  eq(addDays('2026-06-16', 1), '2026-06-17');
  eq(addDays('2026-06-16', -1), '2026-06-15');
  eq(addDays('2026-06-30', 1), '2026-07-01');
  eq(addDays('2026-03-01', -1), '2026-02-28');
});

test('addDays across a DST spring-forward stays on calendar days', () => {
  // US DST 2026 begins Sun Mar 8. Calendar arithmetic must not drift.
  eq(addDays('2026-03-07', 1), '2026-03-08');
  eq(addDays('2026-03-08', 1), '2026-03-09');
});

test('diffDays counts calendar days (a - b)', () => {
  eq(diffDays('2026-06-16', '2026-06-16'), 0);
  eq(diffDays('2026-06-16', '2026-06-15'), 1);
  eq(diffDays('2026-06-15', '2026-06-16'), -1);
  eq(diffDays('2026-07-01', '2026-06-16'), 15);
});

test('daysAgo and isToday', () => {
  const today = '2026-06-16';
  eq(daysAgo('2026-06-16', today), 0);
  eq(daysAgo('2026-06-14', today), 2);
  eq(isToday('2026-06-16', today), true);
  eq(isToday('2026-06-15', today), false);
});

// --- streak with one-missed-day grace ------------------------------------
// DECISION (default, surfaced for veto): an *isolated* single missed day is
// forgiven; TWO OR MORE consecutive missed days break the streak. Streak count
// = number of days actually logged within the surviving run. A not-yet-logged
// TODAY does not reset the streak.
const TODAY = '2026-06-16';
const back = (n) => addDays(TODAY, -n); // back(1) = yesterday

test('empty log → streak 0', () => {
  eq(computeStreak([], TODAY), 0);
});

test('today only → 1', () => {
  eq(computeStreak([back(0)], TODAY), 1);
});

test('today + yesterday → 2', () => {
  eq(computeStreak([back(0), back(1)], TODAY), 2);
});

test('logged y-1..y-3, today NOT yet logged → alive, 3', () => {
  // {-1,-2,-3}: leading single gap at today is forgiven.
  eq(computeStreak([back(1), back(2), back(3)], TODAY), 3);
});

test('isolated single gap {0,-1,-3} → unbroken, 3', () => {
  eq(computeStreak([back(0), back(1), back(3)], TODAY), 3);
});

test('two consecutive misses {0,-1,-4,-5} → breaks, 2', () => {
  eq(computeStreak([back(0), back(1), back(4), back(5)], TODAY), 2);
});

test('every-other-day {0,-2,-4,-6} → survives, 4', () => {
  eq(computeStreak([back(0), back(2), back(4), back(6)], TODAY), 4);
});

test('yesterday only → alive, 1', () => {
  eq(computeStreak([back(1)], TODAY), 1);
});

test('two missed at the front {-2,-3} → broken, 0', () => {
  // today and yesterday both missing = 2 consecutive → current streak gone.
  eq(computeStreak([back(2), back(3)], TODAY), 0);
});

test('unsorted input and duplicates are handled', () => {
  eq(computeStreak([back(2), back(0), back(0), back(4), back(6)], TODAY), 4);
});

test('grace=0 (strict) breaks on any gap', () => {
  eq(computeStreak([back(0), back(1), back(3)], TODAY, { grace: 0 }), 2);
});

// --- run -----------------------------------------------------------------
const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}

export default s;
