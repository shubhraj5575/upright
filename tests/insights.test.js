// Tests for insights.js — the honesty rules are encoded here: minimum sample
// sizes, both-sample-sizes-in-text, no causal verbs, below-threshold deltas
// are neutral and never ranked, flare days excluded, locked hints actionable.

import { createSuite, reportToConsole } from './harness.js';
import { buildInsights, compareDays, strengthOf, daypart, windowKeys, MIN_N } from '../js/core/insights.js';
import { addDays } from '../js/core/dates.js';

const s = createSuite('insights');
const { test, eq, ok } = s;

const TODAY = '2026-07-02';
const day = (i) => addDays(TODAY, -i); // i days ago

function emptyData() {
  return {
    painLog: {}, sleepLog: {}, postureSelfLog: {}, goalsLog: {}, exerciseLog: {},
    postureCamLog: {}, activityLog: {}, flareLog: [],
    settings: { goals: { waterMl: 2000, steps: 6000 } },
  };
}

/** Seed: 6 short-sleep days with stiffness 7, 6 long-sleep days with stiffness 3. */
function sleepStiffData() {
  const d = emptyData();
  for (let i = 1; i <= 6; i++) {
    d.sleepLog[day(i)] = { hours: 5.5, quality: 3, position: 'side', wokeStiff: true, t: 'x' };
    d.painLog[day(i)] = { pain: 5, stiffness: 7 };
  }
  for (let i = 7; i <= 12; i++) {
    d.sleepLog[day(i)] = { hours: 8, quality: 3, position: 'side', wokeStiff: false, t: 'x' };
    d.painLog[day(i)] = { pain: 5, stiffness: 3 };
  }
  return d;
}

// --- helpers ------------------------------------------------------------------
test('compareDays refuses to unlock under MIN_N per side', () => {
  const rows = [
    ...Array.from({ length: MIN_N - 1 }, (_, i) => ({ day: `a${i}`, split: 'a', value: 5 })),
    ...Array.from({ length: MIN_N + 2 }, (_, i) => ({ day: `b${i}`, split: 'b', value: 3 })),
  ];
  eq(compareDays(rows).unlocked, false, 'side A short by one');
});

test('strengthOf bands scale with the threshold', () => {
  eq(strengthOf(0.5, 0.7), 'weak');
  eq(strengthOf(0.9, 0.7), 'moderate');
  eq(strengthOf(1.5, 0.7), 'strong');
});

test('daypart buckets', () => {
  eq(daypart('2026-07-02T08:00:00'), 'morning');
  eq(daypart('2026-07-02T14:00:00'), 'afternoon');
  eq(daypart('2026-07-02T20:00:00'), 'evening');
});

test('windowKeys is oldest-first and ends today', () => {
  const keys = windowKeys(TODAY, 5);
  eq(keys.length, 5);
  eq(keys[4], TODAY);
  eq(keys[0], day(4));
});

// --- unlock behaviour ------------------------------------------------------------
test('sleep→stiffness unlocks with exact expected text', () => {
  const res = buildInsights(sleepStiffData(), TODAY);
  const r = res.all.find((x) => x.id === 'sleep-stiffness');
  ok(r.unlocked, 'unlocked with 6v6');
  eq(r.text.includes('7/10'), true, 'short-night mean cited');
  eq(r.text.includes('3/10'), true, 'long-night mean cited');
  ok(r.text.includes('6 days'), 'sample sizes cited');
  eq(r.direction, 'higher');
  eq(r.strength, 'strong');
});

test('sparse data yields locked states with actionable hints', () => {
  const res = buildInsights(emptyData(), TODAY);
  eq(res.top.length, 0, 'nothing fabricated from nothing');
  ok(res.locked.length >= 8, 'most rules locked');
  for (const l of res.locked) {
    ok(l.lockedText && /log|use|mark|rate|rating|tap|start/i.test(l.lockedText), `hint says what to do: ${l.lockedText}`);
  }
});

test('no unlocked comparison ever hides its sample sizes', () => {
  const res = buildInsights(sleepStiffData(), TODAY);
  for (const r of res.unlocked) {
    if (r.direction === 'none') continue;
    ok(/\d+ (day|night|week|entr)/.test(r.text), `${r.id} cites n: ${r.text}`);
  }
});

test('HONESTY: no causal language anywhere', () => {
  const res = buildInsights(sleepStiffData(), TODAY);
  for (const r of res.all) {
    const text = r.text || r.lockedText || '';
    eq(/\bcauses?\b|\bbecause\b|due to|leads to|improves\b|reduces\b|proves\b/i.test(text), false, `${r.id}: ${text}`);
  }
});

test('below-threshold delta → neutral, and never in the top slots', () => {
  const d = emptyData();
  for (let i = 1; i <= 6; i++) {
    d.sleepLog[day(i)] = { hours: 5.5, quality: 3, position: 'side', wokeStiff: false, t: 'x' };
    d.painLog[day(i)] = { pain: 5, stiffness: 5.2 };
  }
  for (let i = 7; i <= 12; i++) {
    d.sleepLog[day(i)] = { hours: 8, quality: 3, position: 'side', wokeStiff: false, t: 'x' };
    d.painLog[day(i)] = { pain: 5, stiffness: 5 };
  }
  const res = buildInsights(d, TODAY);
  const r = res.all.find((x) => x.id === 'sleep-stiffness');
  eq(r.direction, 'none');
  ok(/no clear difference/i.test(r.text), r.text);
  eq(res.top.some((t) => t.id === 'sleep-stiffness'), false, 'neutral never ranks');
});

test('flare days are excluded from pain comparisons and noted', () => {
  const d = sleepStiffData();
  // A flare covering the short-sleep days would fake the pattern; exclude it.
  d.flareLog = [{ id: 'f', startDay: day(6), endDay: day(1), startedAt: 'x', endedAt: 'y', severity: 7 }];
  const res = buildInsights(d, TODAY);
  const r = res.all.find((x) => x.id === 'sleep-stiffness');
  eq(r.unlocked, false, 'short-sleep side lost its days to the flare exclusion');
});

test('posture worst-hours clusters slumped check-ins', () => {
  const d = emptyData();
  for (let i = 1; i <= 8; i++) {
    d.postureSelfLog[day(i)] = [
      { t: `${day(i)}T14:30:00`, rating: 1 },
      { t: `${day(i)}T09:00:00`, rating: 4 },
    ];
  }
  const res = buildInsights(d, TODAY);
  const r = res.all.find((x) => x.id === 'posture-hours');
  ok(r.unlocked);
  ok(/afternoon/.test(r.text), r.text);
});

test('flare-recovery only speaks with 2+ completed flares', () => {
  const d = emptyData();
  d.flareLog = [{ id: 'f1', startDay: '2026-05-01', endDay: '2026-05-04', startedAt: 'x', endedAt: 'y', severity: 5 }];
  const one = buildInsights(d, TODAY);
  eq(one.all.some((r) => r.id === 'flare-recovery'), false, 'silent with one');
  d.flareLog.push({ id: 'f2', startDay: '2026-06-01', endDay: '2026-06-02', startedAt: 'x', endedAt: 'y', severity: 5 });
  const two = buildInsights(d, TODAY);
  const r = two.all.find((x) => x.id === 'flare-recovery');
  ok(r && r.unlocked);
  ok(r.text.includes('All 2'), r.text);
  ok(r.text.includes('3 days'), 'avg (4+2)/2 = 3 cited');
});

test('adherence rules report observed rates with n', () => {
  const d = emptyData();
  for (let i = 1; i <= 10; i++) d.goalsLog[day(i)] = { waterMl: i <= 7 ? 2200 : 500, steps: 0 };
  const res = buildInsights(d, TODAY);
  const r = res.all.find((x) => x.id === 'water-adherence');
  ok(r.unlocked);
  ok(r.text.includes('7 of the 10 logged days') && r.text.includes('70%'), r.text);
});

test('camera trend compares weeks only with 3+ monitored days each', () => {
  const d = emptyData();
  const dayRec = (goodPct) => ({ monitoredMs: 3600000, goodMs: 36000 * goodPct, poorMs: 0, awayMs: 0, slouchEvents: 0, worstStreakMs: 0, scoreSum: 0, scoreCount: 0, sessions: 1, awayCount: 0, lastSessionEndedAt: null });
  for (let i = 1; i <= 4; i++) d.postureCamLog[day(i)] = dayRec(85);
  for (let i = 8; i <= 11; i++) d.postureCamLog[day(i)] = dayRec(60);
  const res = buildInsights(d, TODAY);
  const r = res.all.find((x) => x.id === 'cam-trend');
  ok(r.unlocked, 'unlocked with 4 days each week');
  ok(r.text.includes('85%') && r.text.includes('60%'), r.text);
  eq(r.direction, 'higher');
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
