// Tests for cam-diagnostics.js — the pure classifier + rollup. The impure
// runner (real camera / model) is exercised manually via "Test my setup".

import { createSuite, reportToConsole } from './harness.js';
import { classifyPoseVisibility, summarizeChecks, CHECKS } from '../js/modules/cam-diagnostics.js';

const s = createSuite('cam-diagnostics');
const { test, eq, ok } = s;

function kp(score) {
  // 17 COCO keypoints, uniform confidence.
  return Array.from({ length: 17 }, () => ({ x: 100, y: 100, score }));
}

test('there are 11 checks with unique ids', () => {
  eq(CHECKS.length, 11);
  eq(new Set(CHECKS.map((c) => c.id)).size, 11);
});

test('no keypoints → fail with positioning hint', () => {
  const r = classifyPoseVisibility(null);
  eq(r.state, 'fail');
  ok(/sit/i.test(r.detail) || /camera/i.test(r.detail), 'hint is actionable');
});

test('missing shoulders → warn about framing', () => {
  const points = kp(0.9);
  points[5].score = 0.1; // left shoulder invisible
  const r = classifyPoseVisibility(points);
  eq(r.state, 'warn');
  ok(/shoulder/i.test(r.detail));
});

test('weak confidence overall → warn about light', () => {
  const r = classifyPoseVisibility(kp(0.35));
  eq(r.state, 'warn');
  ok(/light|lamp/i.test(r.detail));
});

test('clear view → pass', () => {
  eq(classifyPoseVisibility(kp(0.9)).state, 'pass');
});

test('summarize: fail dominates, then warn, then all-clear', () => {
  const fail = summarizeChecks([{ state: 'pass' }, { state: 'fail' }, { state: 'warn' }]);
  eq(fail.fail, 1);
  ok(/blocking/i.test(fail.verdict));
  const warn = summarizeChecks([{ state: 'pass' }, { state: 'warn' }]);
  ok(/caveat/i.test(warn.verdict));
  const clean = summarizeChecks([{ state: 'pass' }, { state: 'pass' }]);
  ok(/ready/i.test(clean.verdict));
  const skip = summarizeChecks([{ state: 'pass' }, { state: 'skip' }]);
  eq(skip.skip, 1);
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
