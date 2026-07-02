// Tests for posture-score.js — verdict → 0-100 mapping, bands, EMA smoothing.

import { createSuite, reportToConsole } from './harness.js';
import { scoreFromVerdict, bandFor, makeEma, BAND_GOOD, BAND_OK } from '../js/modules/posture-score.js';
import { thresholds } from '../js/modules/posture-heuristic.js';

const s = createSuite('posture-score');
const { test, eq, ok } = s;

const v = (drop, tilt = 0, lateral = 0, state = 'good') => ({ state, drop, tilt, lateral });

test('no score without a pose or baseline', () => {
  eq(scoreFromVerdict(null), null);
  eq(scoreFromVerdict({ state: 'no-pose' }), null);
  eq(scoreFromVerdict({ state: 'uncalibrated' }), null);
});

test('perfect match with baseline scores 100', () => {
  eq(scoreFromVerdict(v(0, 0, 0)), 100);
});

test('exactly at the slouch threshold scores ~50', () => {
  const t = thresholds(0.5);
  eq(scoreFromVerdict(v(t.slouch), 0.5), 50);
});

test('twice the threshold floors at 0', () => {
  const t = thresholds(0.5);
  eq(scoreFromVerdict(v(t.slouch * 2), 0.5), 0);
  eq(scoreFromVerdict(v(t.slouch * 5), 0.5), 0, 'never negative');
});

test('sitting taller than baseline is not penalised', () => {
  eq(scoreFromVerdict(v(-0.5)), 100, 'negative drop (taller) is fine');
});

test('worst axis dominates', () => {
  const t = thresholds(0.5);
  const half = scoreFromVerdict(v(t.slouch / 2, 0, 0), 0.5);
  const both = scoreFromVerdict(v(t.slouch / 2, t.tilt, 0), 0.5);
  eq(half, 75, 'half threshold → 75');
  eq(both, 50, 'tilt at threshold dominates');
});

test('sensitivity changes the scale', () => {
  const strict = scoreFromVerdict(v(0.1), 1);
  const relaxed = scoreFromVerdict(v(0.1), 0);
  ok(strict < relaxed, 'same drop scores worse when strict');
});

test('bands', () => {
  eq(bandFor(100), 'good');
  eq(bandFor(BAND_GOOD), 'good');
  eq(bandFor(BAND_GOOD - 1), 'ok');
  eq(bandFor(BAND_OK), 'ok');
  eq(bandFor(BAND_OK - 1), 'poor');
  eq(bandFor(0), 'poor');
});

test('EMA smooths and ignores nulls', () => {
  const ema = makeEma(0.5);
  eq(ema.value(), null);
  eq(ema.push(100), 100, 'first sample adopted directly');
  eq(ema.push(50), 75, '0.5 blend');
  eq(ema.push(null), 75, 'null passthrough keeps value');
  ema.reset();
  eq(ema.value(), null);
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
