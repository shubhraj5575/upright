// Tests for alert-ladder.js — escalation timing, snooze, freeze, resets.

import { createSuite, reportToConsole } from './harness.js';
import {
  createLadder, stepLadder, snoozeUntil,
  STATUS_MS, TOAST_MS, NOTIFY_MS, RENOTIFY_MS,
} from '../js/modules/alert-ladder.js';

const s = createSuite('alert-ladder');
const { test, eq, ok } = s;

const T0 = 1_000_000;

/** Drive the ladder through (state, atMs) steps; collect fired rungs. */
function run(steps, opts = {}) {
  let ladder = createLadder();
  const fired = [];
  for (const [state, at] of steps) {
    const res = stepLadder(ladder, { state, now: T0 + at, ...opts });
    ladder = res.ladder;
    if (res.fire) fired.push([res.fire, at]);
  }
  return { ladder, fired };
}

test('good posture never fires', () => {
  const { fired } = run([['good', 0], ['good', 5000], ['good', 60000]]);
  eq(fired.length, 0);
});

test('escalates status → toast → notify at the right times', () => {
  const { fired } = run([
    ['poor', 0], ['poor', 2000], ['poor', STATUS_MS], ['poor', 8000],
    ['poor', TOAST_MS], ['poor', 20000], ['poor', NOTIFY_MS],
  ]);
  eq(JSON.stringify(fired), JSON.stringify([['status', STATUS_MS], ['toast', TOAST_MS], ['notify', NOTIFY_MS]]));
});

test('each rung fires once per stretch; notify re-fires after 2 min', () => {
  const { fired } = run([
    ['poor', 0], ['poor', NOTIFY_MS], ['poor', NOTIFY_MS + 1000],
    ['poor', NOTIFY_MS + RENOTIFY_MS - 1], ['poor', NOTIFY_MS + RENOTIFY_MS],
  ]);
  const notifies = fired.filter(([f]) => f === 'notify').map(([, at]) => at);
  eq(JSON.stringify(notifies), JSON.stringify([NOTIFY_MS, NOTIFY_MS + RENOTIFY_MS]));
});

test('recovering resets the ladder — a new stretch escalates again', () => {
  let ladder = createLadder();
  let res;
  res = stepLadder(ladder, { state: 'poor', now: T0 }); ladder = res.ladder;
  res = stepLadder(ladder, { state: 'poor', now: T0 + TOAST_MS }); ladder = res.ladder;
  res = stepLadder(ladder, { state: 'good', now: T0 + TOAST_MS + 1000 }); ladder = res.ladder;
  eq(ladder.poorSince, 0, 'reset');
  res = stepLadder(ladder, { state: 'poor', now: T0 + 60000 }); ladder = res.ladder;
  res = stepLadder(ladder, { state: 'poor', now: T0 + 60000 + STATUS_MS });
  eq(res.fire, 'status', 'fresh stretch fires from the bottom');
});

test('snooze suppresses toast/notify but not status', () => {
  const until = snoozeUntil(T0, 5);
  const { fired } = run([
    ['poor', 0], ['poor', STATUS_MS], ['poor', TOAST_MS], ['poor', NOTIFY_MS],
  ], { snoozedUntil: until });
  eq(JSON.stringify(fired), JSON.stringify([['status', STATUS_MS]]));
});

test('snooze expiry re-arms the upper rungs mid-stretch', () => {
  let ladder = createLadder();
  const until = T0 + 20000;
  let res = stepLadder(ladder, { state: 'poor', now: T0, snoozedUntil: until }); ladder = res.ladder;
  res = stepLadder(ladder, { state: 'poor', now: T0 + TOAST_MS, snoozedUntil: until }); ladder = res.ladder;
  eq(res.fire, 'status', 'status only while snoozed');
  res = stepLadder(ladder, { state: 'poor', now: T0 + 25000, snoozedUntil: until }); ladder = res.ladder;
  eq(res.fire, 'toast', 'toast fires once snooze lapses');
});

test('frozen (quiet hours / flare) caps at status', () => {
  const { fired } = run([
    ['poor', 0], ['poor', STATUS_MS], ['poor', NOTIFY_MS * 3],
  ], { frozen: true });
  eq(JSON.stringify(fired), JSON.stringify([['status', STATUS_MS]]));
});

test('away and paused reset like good', () => {
  for (const state of ['away', 'paused']) {
    let ladder = createLadder();
    let res = stepLadder(ladder, { state: 'poor', now: T0 }); ladder = res.ladder;
    res = stepLadder(ladder, { state, now: T0 + 5000 }); ladder = res.ladder;
    eq(ladder.poorSince, 0, `${state} resets`);
  }
});

test('heldMs reports the stretch length', () => {
  let ladder = createLadder();
  let res = stepLadder(ladder, { state: 'poor', now: T0 }); ladder = res.ladder;
  res = stepLadder(ladder, { state: 'poor', now: T0 + 7000 });
  eq(res.heldMs, 7000);
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
