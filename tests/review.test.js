// Tests for review.js — week math, readiness gating, deterministic win/focus.

import { createSuite, reportToConsole } from './harness.js';
import { weekStartKey, summarizeWeek, isReviewReady, buildWeeklyReview } from '../js/core/review.js';

const s = createSuite('review');
const { test, eq, ok } = s;

// 2026-07-02 is a Thursday; that week's Monday is 2026-06-29.
test('weekStartKey finds Monday', () => {
  eq(weekStartKey('2026-07-02'), '2026-06-29');
  eq(weekStartKey('2026-06-29'), '2026-06-29', 'Monday maps to itself');
  eq(weekStartKey('2026-07-05'), '2026-06-29', 'Sunday belongs to the same week');
});

function dataset() {
  // Last full week relative to today=2026-07-02 is Mon 2026-06-22 … Sun 2026-06-28.
  const painLog = {};
  const goalsLog = {};
  const exerciseLog = {};
  // last week: pain improving, 4 exercise days, 3 step-goal days
  const lastWeek = ['2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28'];
  lastWeek.forEach((k, i) => {
    painLog[k] = { pain: 3, stiffness: 4 };
    goalsLog[k] = { waterMl: 2000, steps: i < 3 ? 7000 : 2000 };
    if (i < 4) exerciseLog[k] = ['cat-cow'];
  });
  // week before: worse pain
  const prevWeek = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19'];
  prevWeek.forEach((k) => { painLog[k] = { pain: 5, stiffness: 5 }; });
  return { painLog, goalsLog, exerciseLog, sleepLog: {}, postureCamLog: {}, postureSelfLog: {}, flareLog: [], settings: { goals: { waterMl: 2000, steps: 6000 } } };
}

test('summarizeWeek aggregates the right days', () => {
  const sum = summarizeWeek(dataset(), '2026-06-22');
  eq(sum.loggedDays, 7);
  eq(sum.avgPain, 3);
  eq(sum.exerciseDays, 4);
  eq(sum.stepMetDays, 3);
  eq(sum.waterMetDays, 7);
});

test('isReviewReady: ready for a data-rich unseen week, not after seen', () => {
  const d = dataset();
  const r1 = isReviewReady(d, '2026-07-02', null);
  eq(r1.ready, true);
  eq(r1.weekKey, '2026-06-22');
  const r2 = isReviewReady(d, '2026-07-02', '2026-06-22');
  eq(r2.ready, false, 'already seen this week’s review');
});

test('isReviewReady: sparse week (<3 logged days) is not ready', () => {
  const d = { painLog: { '2026-06-23': { pain: 3, stiffness: 3 } }, goalsLog: {}, exerciseLog: {}, sleepLog: {}, postureCamLog: {}, postureSelfLog: {}, flareLog: [], settings: {} };
  eq(isReviewReady(d, '2026-07-02', null).ready, false);
});

test('win prefers the pain improvement and cites both weeks', () => {
  const rev = buildWeeklyReview(dataset(), '2026-07-02');
  ok(/Pain eased/.test(rev.win), rev.win);
  ok(rev.win.includes('3/10') && rev.win.includes('5/10'), 'cites both averages');
});

test('flare week overrides the win', () => {
  const d = dataset();
  d.flareLog = [{ id: 'f', startDay: '2026-06-24', endDay: '2026-06-26', startedAt: 'x', endedAt: 'y', severity: 6 }];
  const rev = buildWeeklyReview(d, '2026-07-02');
  eq(rev.flareWeek, true);
  ok(/flare/i.test(rev.win), 'win acknowledges the flare');
});

test('focus is deterministic: low step days → walking suggestion', () => {
  const d = dataset();
  // step goal met only 3 days → not ≤2; tighten: make steps low everywhere
  Object.keys(d.goalsLog).forEach((k) => { d.goalsLog[k].steps = 1000; });
  const rev = buildWeeklyReview(d, '2026-07-02');
  ok(/step/i.test(rev.focus), rev.focus);
});

test('review never uses causal language', () => {
  const rev = buildWeeklyReview(dataset(), '2026-07-02');
  const text = rev.win + ' ' + rev.focus;
  eq(/because|causes|due to|leads to|thanks to/i.test(text), false, text);
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
