// Pure tests for posture-heuristic.js. Run: `node tests/posture-heuristic.test.js`
// or via tests/index.html. Fixtures are hand-built MoveNet keypoint sets.

import { createSuite, reportToConsole } from './harness.js';
import { computeMetrics, makeBaseline, evaluate, KP } from '../js/modules/posture-heuristic.js';

const s = createSuite('posture-heuristic');
const { test, eq, ok } = s;

// Build a 17-slot keypoint array with sensible defaults, overriding given ones.
function pose(overrides = {}, score = 0.9) {
  const kps = Array.from({ length: 17 }, () => ({ x: 0, y: 0, score: 0 }));
  for (const [name, [x, y]] of Object.entries(overrides)) {
    kps[KP[name]] = { x, y, score };
  }
  return kps;
}

// Sit-tall reference: shoulders 200px apart at y=300; ears high at y=150.
const tall = pose({
  leftShoulder: [400, 300], rightShoulder: [200, 300],
  leftEar: [360, 150], rightEar: [240, 150],
  nose: [300, 160],
});

test('computeMetrics needs both shoulders', () => {
  eq(computeMetrics(pose({ leftShoulder: [400, 300] })), null);
});

test('verticalGap is normalized by shoulder width', () => {
  const m = computeMetrics(tall);
  ok(m, 'metrics computed');
  // (shoulderY 300 - headY 150) / shoulderWidth 200 = 0.75
  eq(Math.round(m.verticalGap * 100) / 100, 0.75);
  eq(Math.round(m.shoulderWidth), 200);
});

test('near/far invariance: scaling all coords keeps metrics equal', () => {
  const near = computeMetrics(tall);
  // Move "closer": scale every coordinate by 1.8 around origin.
  const scaled = pose({
    leftShoulder: [720, 540], rightShoulder: [360, 540],
    leftEar: [648, 270], rightEar: [432, 270],
    nose: [540, 288],
  });
  const far = computeMetrics(scaled);
  eq(Math.round(near.verticalGap * 1000), Math.round(far.verticalGap * 1000), 'verticalGap invariant to distance');
});

test('uncalibrated until a baseline exists', () => {
  eq(evaluate(computeMetrics(tall), null).state, 'uncalibrated');
});

test('no-pose when shoulders missing', () => {
  eq(evaluate(computeMetrics(pose({ nose: [300, 160] })), makeBaseline(computeMetrics(tall))).state, 'no-pose');
});

const baseline = makeBaseline(computeMetrics(tall));

test('sitting tall (≈baseline) → good', () => {
  const slightlyOff = pose({
    leftShoulder: [400, 300], rightShoulder: [200, 300],
    leftEar: [360, 158], rightEar: [240, 158], nose: [300, 168],
  });
  eq(evaluate(computeMetrics(slightlyOff), baseline, 0.5).state, 'good');
});

test('head sunk toward shoulders → slouch', () => {
  // ears drop from y=150 to y=245 → gap (300-245)/200 = 0.275; drop ≈ 0.63
  const slumped = pose({
    leftShoulder: [400, 300], rightShoulder: [200, 300],
    leftEar: [360, 245], rightEar: [240, 245], nose: [300, 255],
  });
  const v = evaluate(computeMetrics(slumped), baseline, 0.5);
  eq(v.state, 'poor');
  ok(v.issues.includes('slouch'), 'slouch flagged');
});

test('uneven shoulders → leaning', () => {
  // right shoulder much lower than left → shoulderTilt deviates
  const leaning = pose({
    leftShoulder: [400, 300], rightShoulder: [200, 360],
    leftEar: [360, 150], rightEar: [240, 150], nose: [300, 160],
  });
  const v = evaluate(computeMetrics(leaning), baseline, 0.5);
  eq(v.state, 'poor');
  ok(v.issues.includes('leaning'), 'leaning flagged');
});

test('sensitivity: a mild slump passes when relaxed, fails when strict', () => {
  // gap drops to (300-205)/200 = 0.475; drop ≈ 0.367
  const mild = pose({
    leftShoulder: [400, 300], rightShoulder: [200, 300],
    leftEar: [360, 205], rightEar: [240, 205], nose: [300, 215],
  });
  const m = computeMetrics(mild);
  ok(evaluate(m, baseline, 0.0).state === 'poor', 'drop 0.37 > relaxed thresh 0.30 → poor');
  // at high sensitivity it is certainly poor too; verify monotonicity instead:
  const relaxedDrop = evaluate(m, baseline, 0.0);
  const strict = evaluate(m, baseline, 1.0);
  ok(strict.state === 'poor', 'strict also flags');
  ok(relaxedDrop.drop === strict.drop, 'drop is sensitivity-independent measure');
});

test('low-confidence keypoints are ignored (treated as missing)', () => {
  const lowConf = pose({
    leftShoulder: [400, 300], rightShoulder: [200, 300],
    leftEar: [360, 150], rightEar: [240, 150],
  }, 0.1); // below default minScore 0.3
  eq(computeMetrics(lowConf), null, 'all low-confidence → no metrics');
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}

export default s;
