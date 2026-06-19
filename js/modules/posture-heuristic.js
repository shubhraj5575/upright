// posture-heuristic.js — PURE posture analysis. No DOM, no tensors, no camera.
// Takes MoveNet keypoints and a calibrated baseline and returns a verdict.
// Kept separate from posture-camera.js so it can be unit-tested in Node.
//
// Key idea: everything is normalized by SHOULDER WIDTH. That makes the verdict
// invariant to how near/far the user sits from the webcam — moving closer
// scales all pixel distances up together, so ratios stay stable and we avoid
// false "slouch" alarms just from leaning toward the screen.

// COCO/MoveNet keypoint indices.
export const KP = {
  nose: 0,
  leftEye: 1, rightEye: 2,
  leftEar: 3, rightEar: 4,
  leftShoulder: 5, rightShoulder: 6,
  leftHip: 11, rightHip: 12,
};

/**
 * Reduce raw keypoints to normalized posture metrics, or null if the upper
 * body isn't reliably visible.
 * @param {{x:number,y:number,score:number}[]} keypoints  indexed by COCO id
 * @param {number} [minScore]
 */
export function computeMetrics(keypoints, minScore = 0.3) {
  if (!Array.isArray(keypoints)) return null;
  const get = (i) => {
    const k = keypoints[i];
    return k && (k.score == null || k.score >= minScore) ? k : null;
  };

  const ls = get(KP.leftShoulder);
  const rs = get(KP.rightShoulder);
  if (!ls || !rs) return null; // need both shoulders to anchor everything

  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (sw < 1e-3) return null;

  const shoulderY = (ls.y + rs.y) / 2;
  const shoulderX = (ls.x + rs.x) / 2;

  // Head reference: prefer ears (stable), fall back to eyes, then nose.
  const le = get(KP.leftEar), re = get(KP.rightEar);
  const lEye = get(KP.leftEye), rEye = get(KP.rightEye);
  let headX, headY;
  if (le && re) { headX = (le.x + re.x) / 2; headY = (le.y + re.y) / 2; }
  else if (lEye && rEye) { headX = (lEye.x + rEye.x) / 2; headY = (lEye.y + rEye.y) / 2; }
  else { const n = get(KP.nose); if (!n) return null; headX = n.x; headY = n.y; }

  return {
    shoulderWidth: sw,
    // How high the head sits above the shoulder line (image y grows downward,
    // so shoulders are below the head → positive). Slumping shrinks this.
    verticalGap: (shoulderY - headY) / sw,
    // Head off the shoulder centre (turning/leaning sideways).
    lateralOffset: (headX - shoulderX) / sw,
    // Shoulder line tilt (uneven shoulders → leaning to one side).
    shoulderTilt: (rs.y - ls.y) / sw,
  };
}

/** A baseline is just the metrics captured while sitting tall. */
export function makeBaseline(metrics) {
  if (!metrics) return null;
  return {
    verticalGap: metrics.verticalGap,
    lateralOffset: metrics.lateralOffset,
    shoulderTilt: metrics.shoulderTilt,
  };
}

/**
 * Compare current metrics against the baseline.
 * @param {object|null} metrics  from computeMetrics()
 * @param {object|null} baseline from makeBaseline()
 * @param {number} [sensitivity] 0..1 — higher = stricter (smaller tolerance)
 * @returns {{ state:'no-pose'|'uncalibrated'|'good'|'poor', issues?:string[], drop?:number, tilt?:number, lateral?:number }}
 */
export function evaluate(metrics, baseline, sensitivity = 0.5) {
  if (!metrics) return { state: 'no-pose' };
  if (!baseline) return { state: 'uncalibrated' };

  const s = Math.max(0, Math.min(1, sensitivity));
  // Fractional collapse of the head-above-shoulders gap vs. baseline.
  const drop = (baseline.verticalGap - metrics.verticalGap) / Math.max(Math.abs(baseline.verticalGap), 1e-3);
  const tilt = Math.abs(metrics.shoulderTilt - baseline.shoulderTilt);
  const lateral = Math.abs(metrics.lateralOffset - baseline.lateralOffset);

  // Thresholds tighten as sensitivity rises.
  const slouchThresh = 0.30 - 0.22 * s; // s=0→0.30, 0.5→0.19, 1→0.08
  const tiltThresh = 0.22 - 0.12 * s; // shoulder tilt / lateral tolerance

  const issues = [];
  if (drop > slouchThresh) issues.push('slouch');
  if (tilt > tiltThresh) issues.push('leaning');
  if (lateral > tiltThresh) issues.push('off-center');

  return { state: issues.length ? 'poor' : 'good', issues, drop, tilt, lateral };
}
