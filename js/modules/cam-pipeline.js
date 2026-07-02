// cam-pipeline.js — owns the heavy ML plumbing for camera posture monitoring:
// script loading, TF.js backend selection (webgl → cpu fallback), detector
// creation from the VENDORED MoveNet model, and the one-off warm-up inference.
//
// The detector is cached at module level and deliberately NOT disposed on view
// teardown: cold start (libs + model + shader warm-up) can take many seconds,
// and navigating back shouldn't pay that again. Camera *tracks* are a privacy
// surface and are always stopped by the shell — never cached here.

const MODEL_URL = 'vendor/movenet/model.json';
const TF_SRC = 'vendor/tfjs/tf.min.js';
const POSE_SRC = 'vendor/tfjs/pose-detection.min.js';

let libsPromise = null;
let detectorState = null; // { detector, backend, warmupMs } once resolved
let detectorPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

export async function loadLibs() {
  if (window.poseDetection && window.tf) return;
  if (!libsPromise) {
    libsPromise = (async () => {
      await loadScript(TF_SRC);
      await loadScript(POSE_SRC);
    })().catch((e) => { libsPromise = null; throw e; });
  }
  await libsPromise;
}

/** The backend actually in use ('webgl' | 'cpu'), or null before init. */
export function activeBackend() {
  return detectorState ? detectorState.backend : null;
}

/** Cached pipeline state if it's already built (no await, no side effects). */
export function current() {
  return detectorState;
}

/**
 * Build (or return the cached) detector.
 * @param {(stage:'libs'|'backend'|'model'|'warmup')=>void} [onStage]
 * @returns {Promise<{ detector:object, backend:string, warmupMs:number }>}
 */
export async function getDetector(onStage = () => {}) {
  if (detectorState) return detectorState;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      onStage('libs');
      await loadLibs();
      const tf = window.tf;

      // webgl → cpu fallback. setBackend resolves false (or throws) when a
      // backend can't initialise, e.g. no GPU/WebGL in this browser.
      onStage('backend');
      let backend = 'webgl';
      try {
        const ok = await tf.setBackend('webgl');
        if (!ok) throw new Error('webgl backend rejected');
        await tf.ready();
      } catch (_) {
        backend = 'cpu';
        await tf.setBackend('cpu');
        await tf.ready();
      }

      onStage('model');
      const detector = await window.poseDetection.createDetector(
        window.poseDetection.SupportedModels.MoveNet,
        { modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, modelUrl: MODEL_URL }
      );

      // Warm-up: the FIRST inference compiles shaders / allocates buffers and
      // can take seconds. Run it once on a blank canvas so the live loop
      // never stacks calls behind a slow first tick.
      onStage('warmup');
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const t0 = performance.now();
      try {
        await detector.estimatePoses(canvas, { maxPoses: 1, flipHorizontal: false });
      } catch (_) { /* warm-up is best effort */ }
      const warmupMs = Math.round(performance.now() - t0);

      detectorState = { detector, backend, warmupMs };
      return detectorState;
    })().catch((e) => { detectorPromise = null; throw e; });
  }
  return detectorPromise;
}

/**
 * One inference. Returns raw poses (or null on failure — callers treat that
 * as a skipped frame, not an error).
 */
export async function estimate(input) {
  if (!detectorState) return null;
  try {
    return await detectorState.detector.estimatePoses(input, { maxPoses: 1, flipHorizontal: false });
  } catch (_) {
    return null;
  }
}
