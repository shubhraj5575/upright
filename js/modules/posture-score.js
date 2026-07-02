// posture-score.js — PURE. Maps a posture verdict (from posture-heuristic's
// evaluate()) to a friendly 0–100 score for the live gauge, with bands and a
// small EMA smoother so the needle doesn't jitter frame to frame.
//
// Scale: 100 = matches the calibrated baseline; crossing an issue threshold
// (the moment evaluate() would call it "poor") lands at ~50; twice the
// threshold → 0. Bands: good ≥ 75, ok ≥ 50, poor < 50.

import { thresholds } from './posture-heuristic.js';

export const BAND_GOOD = 75;
export const BAND_OK = 50;

/**
 * @param {{ state:string, drop?:number, tilt?:number, lateral?:number }} verdict
 * @param {number} [sensitivity] 0..1 — must match what evaluate() was given
 * @returns {number|null} 0..100, or null when there is nothing to score
 */
export function scoreFromVerdict(verdict, sensitivity = 0.5) {
  if (!verdict || verdict.state === 'no-pose' || verdict.state === 'uncalibrated') return null;
  const t = thresholds(sensitivity);
  // Per-axis "how far toward/past the line", 1.0 = exactly at threshold.
  const ratios = [
    Math.max(0, verdict.drop || 0) / t.slouch, // only sinking counts as slouch
    Math.abs(verdict.tilt || 0) / t.tilt,
    Math.abs(verdict.lateral || 0) / t.tilt,
  ];
  const worst = Math.max(...ratios);
  const score = 100 - 50 * worst;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** @returns {'good'|'ok'|'poor'} */
export function bandFor(score) {
  if (score >= BAND_GOOD) return 'good';
  if (score >= BAND_OK) return 'ok';
  return 'poor';
}

/**
 * Exponential moving average with null passthrough (a lost pose doesn't drag
 * the average down — it just pauses it).
 * @param {number} [alpha] 0..1 weight of the new sample
 */
export function makeEma(alpha = 0.3) {
  let value = null;
  return {
    push(v) {
      if (v == null) return value;
      value = value == null ? v : value * (1 - alpha) + v * alpha;
      return value;
    },
    value: () => value,
    reset: () => { value = null; },
  };
}
