// Tests for flare.js — start/end lifecycle, streak-protection day keys,
// adjusted goals, history stats.

import { createSuite, reportToConsole } from './harness.js';
import {
  activeFlare, startFlare, endFlare, completedFlares, activeFlareDays,
  flareDayKeys, adjustedGoals, flareHistoryStats,
} from '../js/core/flare.js';

const s = createSuite('flare');
const { test, eq, ok } = s;

const NOW = '2026-07-02T10:00:00.000Z';
const TODAY = '2026-07-02';

test('start → active → end lifecycle', () => {
  let log = startFlare([], { severity: 6, trigger: 'lifting', now: NOW, today: TODAY });
  eq(log.length, 1);
  ok(activeFlare(log), 'flare is active');
  eq(activeFlare(log).severity, 6);
  log = endFlare(log, { now: '2026-07-05T10:00:00.000Z', today: '2026-07-05' });
  eq(activeFlare(log), null, 'ended');
  eq(completedFlares(log)[0].durationDays, 4, 'inclusive duration');
});

test('at most one active flare', () => {
  let log = startFlare([], { severity: 5, now: NOW, today: TODAY });
  const again = startFlare(log, { severity: 9, now: NOW, today: TODAY });
  eq(again, log, 'second start is a no-op');
});

test('endFlare without an active flare is a no-op', () => {
  const log = [{ id: 'x', startDay: '2026-06-01', endDay: '2026-06-03', startedAt: 'a', endedAt: 'b', severity: 4 }];
  eq(endFlare(log, { now: NOW, today: TODAY }), log);
});

test('severity is clamped to 0–10', () => {
  const log = startFlare([], { severity: 42, now: NOW, today: TODAY });
  eq(log[0].severity, 10);
});

test('flareDayKeys spans start..end inclusive, active runs to today', () => {
  const log = [
    { id: 'a', startDay: '2026-06-28', endDay: '2026-06-30', endedAt: 'x', startedAt: 'y', severity: 5 },
    { id: 'b', startDay: '2026-07-01', endDay: null, endedAt: null, startedAt: 'z', severity: 5 },
  ];
  const keys = flareDayKeys(log, TODAY);
  ok(keys.has('2026-06-28') && keys.has('2026-06-29') && keys.has('2026-06-30'), 'completed span');
  ok(keys.has('2026-07-01') && keys.has('2026-07-02'), 'active span through today');
  eq(keys.has('2026-06-27'), false);
  eq(keys.has('2026-07-03'), false);
});

test('streak protection across midnight: active flare covers both days', () => {
  const log = startFlare([], { severity: 5, now: '2026-07-01T23:50:00.000Z', today: '2026-07-01' });
  const keys = flareDayKeys(log, '2026-07-02');
  ok(keys.has('2026-07-01') && keys.has('2026-07-02'));
});

test('adjustedGoals reduces steps only, never water; floors at 500', () => {
  const g = { waterMl: 2000, steps: 6000, waterStepMl: 250 };
  const off = adjustedGoals(g, false, 50);
  eq(off.reduced, false);
  eq(off.steps, 6000);
  const on = adjustedGoals(g, true, 50);
  eq(on.reduced, true);
  eq(on.steps, 3000);
  eq(on.waterMl, 2000, 'hydration untouched');
  eq(adjustedGoals({ waterMl: 2000, steps: 600 }, true, 90).steps, 500, 'floor');
});

test('activeFlareDays counts inclusively', () => {
  const log = startFlare([], { severity: 5, now: NOW, today: '2026-06-30' });
  eq(activeFlareDays(log, '2026-07-02'), 3);
  eq(activeFlareDays([], TODAY), 0);
});

test('history stats: count + average duration', () => {
  let log = [];
  log = startFlare(log, { severity: 5, now: '2026-05-01T00:00:00Z', today: '2026-05-01' });
  log = endFlare(log, { now: '2026-05-04T00:00:00Z', today: '2026-05-04' }); // 4 days
  log = startFlare(log, { severity: 5, now: '2026-06-01T00:00:00Z', today: '2026-06-01' });
  log = endFlare(log, { now: '2026-06-02T00:00:00Z', today: '2026-06-02' }); // 2 days
  const stats = flareHistoryStats(log);
  eq(stats.count, 2);
  eq(stats.avgDays, 3);
  eq(flareHistoryStats([]), null);
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
