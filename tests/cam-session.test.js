// Tests for cam-session.js — accumulation, slouch episodes, flush/merge
// semantics (sums-and-counts) and summaries.

import { createSuite, reportToConsole } from './harness.js';
import {
  createSession, accumulate, markAway, takeFlush, mergeDay, emptyDay,
  summarizeDay, pruneLog, SLOUCH_EVENT_MS, MAX_TICK_MS,
} from '../js/modules/cam-session.js';
import { diffDays } from '../js/core/dates.js';

const s = createSuite('cam-session');
const { test, eq, deepEq, ok } = s;

test('accumulates good/poor/away into the right buckets', () => {
  const sess = createSession();
  accumulate(sess, 'good', 1000, 90);
  accumulate(sess, 'poor', 500, 30);
  accumulate(sess, 'away', 2000);
  const p = sess.pending;
  eq(p.goodMs, 1000);
  eq(p.poorMs, 500);
  eq(p.awayMs, 2000);
  eq(p.monitoredMs, 1500, 'monitored = good + poor');
  eq(p.scoreSum, 120);
  eq(p.scoreCount, 2);
});

test('dt is clamped across tab-throttle gaps', () => {
  const sess = createSession();
  accumulate(sess, 'good', 10 * 60 * 1000, null);
  eq(sess.pending.goodMs, MAX_TICK_MS);
});

test('a poor stretch ≥ 4s counts one slouch event, not one per tick', () => {
  const sess = createSession();
  for (let i = 0; i < 10; i++) accumulate(sess, 'poor', 1000, 20);
  eq(sess.pending.slouchEvents, 1, 'counted once');
  eq(sess.pending.worstStreakMs, 10000);
  accumulate(sess, 'good', 1000, 90); // recover
  for (let i = 0; i < 5; i++) accumulate(sess, 'poor', 1000, 20);
  eq(sess.pending.slouchEvents, 2, 'a new stretch counts again');
});

test('short poor blips never count as events', () => {
  const sess = createSession();
  accumulate(sess, 'poor', SLOUCH_EVENT_MS - 1000, 30);
  accumulate(sess, 'good', 1000, 90);
  eq(sess.pending.slouchEvents, 0);
});

test('takeFlush: null when empty; sessions counted exactly once', () => {
  const sess = createSession();
  eq(takeFlush(sess), null, 'nothing to flush');
  accumulate(sess, 'good', 1000, 80);
  const f1 = takeFlush(sess);
  eq(f1.sessions, 1, 'first flush carries the session count');
  accumulate(sess, 'good', 1000, 80);
  const f2 = takeFlush(sess);
  eq(f2.sessions, 0, 'later flushes do not re-count');
  eq(f2.goodMs, 1000, 'pending reset between flushes');
});

test('final flush stamps endedAt only for sessions that produced data', () => {
  const dead = createSession();
  eq(takeFlush(dead, { final: true, endedAt: 'T1' }), null, 'no-data session writes nothing');
  const live = createSession();
  accumulate(live, 'good', 500, 90);
  takeFlush(live);
  const fin = takeFlush(live, { final: true, endedAt: 'T2' });
  eq(fin.lastSessionEndedAt, 'T2');
});

test('markAway counts departures and ends the poor streak', () => {
  const sess = createSession();
  for (let i = 0; i < 5; i++) accumulate(sess, 'poor', 1000, 10);
  markAway(sess);
  eq(sess.pending.awayCount, 1);
  for (let i = 0; i < 5; i++) accumulate(sess, 'poor', 1000, 10);
  eq(sess.pending.slouchEvents, 2, 'streak restarted after away');
});

test('mergeDay adds sums, maxes streak, keeps latest endedAt', () => {
  const day = mergeDay(undefined, { ...emptyDay(), monitoredMs: 1000, goodMs: 800, poorMs: 200, worstStreakMs: 5000, scoreSum: 160, scoreCount: 2, sessions: 1 });
  const merged = mergeDay(day, { ...emptyDay(), monitoredMs: 500, goodMs: 100, poorMs: 400, worstStreakMs: 3000, scoreSum: 40, scoreCount: 1, lastSessionEndedAt: 'T9' });
  eq(merged.monitoredMs, 1500);
  eq(merged.goodMs, 900);
  eq(merged.worstStreakMs, 5000, 'max, not sum');
  eq(merged.scoreSum, 200);
  eq(merged.sessions, 1);
  eq(merged.lastSessionEndedAt, 'T9');
});

test('summarizeDay computes pct/avg; safe on empty', () => {
  const sum = summarizeDay({ ...emptyDay(), monitoredMs: 60000, goodMs: 45000, poorMs: 15000, scoreSum: 240, scoreCount: 3 });
  eq(sum.pctGood, 75);
  eq(sum.avgScore, 80);
  eq(sum.monitoredMin, 1);
  const empty = summarizeDay(undefined);
  eq(empty.pctGood, null);
  eq(empty.avgScore, null);
});

test('pruneLog drops only stale days and is identity when clean', () => {
  const log = { '2026-01-01': { monitoredMs: 1 }, '2026-06-30': { monitoredMs: 2 } };
  const pruned = pruneLog(log, '2026-07-02', 180, diffDays);
  ok(!pruned['2026-01-01'], 'old day dropped');
  ok(pruned['2026-06-30'], 'recent day kept');
  const clean = { '2026-06-30': { monitoredMs: 2 } };
  eq(pruneLog(clean, '2026-07-02', 180, diffDays), clean, 'no copy when nothing to drop');
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
