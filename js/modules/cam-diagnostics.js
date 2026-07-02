// cam-diagnostics.js — "Test my setup" for camera posture monitoring. Runs 11
// sequential checks from browser capability down to "can the model actually
// see you", each reporting pass / warn / fail with a human fix-it hint. This
// is the direct answer to "the camera isn't working — why?".
//
// The classify/summarize helpers are PURE (unit-tested); runDiagnostics() is
// the impure runner that touches real browser APIs and the vendored model.

import * as pipeline from './cam-pipeline.js';
import { keypointQuality } from './posture-heuristic.js';

export const CHECKS = [
  { id: 'secure', label: 'Secure context' },
  { id: 'media-api', label: 'Camera API available' },
  { id: 'permission', label: 'Camera permission' },
  { id: 'devices', label: 'Webcam detected' },
  { id: 'acquire', label: 'Camera opens' },
  { id: 'video', label: 'Video plays' },
  { id: 'libs', label: 'Analysis libraries load' },
  { id: 'backend', label: 'GPU acceleration' },
  { id: 'detector', label: 'Posture model loads' },
  { id: 'warmup', label: 'Model speed' },
  { id: 'pose', label: 'Can the model see you?' },
];

/**
 * PURE: judge pose visibility/lighting from detected keypoints.
 * @param {object[]|null} keypoints
 * @returns {{ state:'pass'|'warn'|'fail', detail:string }}
 */
export function classifyPoseVisibility(keypoints) {
  if (!keypoints || !keypoints.length) {
    return {
      state: 'fail',
      detail: 'No person detected. Sit 50–100 cm from the camera, face it, and add light in front of you (not behind).',
    };
  }
  const q = keypointQuality(keypoints);
  const shoulders = keypoints[5] && keypoints[6]
    && (keypoints[5].score ?? 0) >= 0.3 && (keypoints[6].score ?? 0) >= 0.3;
  if (!shoulders) {
    return {
      state: 'warn',
      detail: 'Your head is visible but not both shoulders. Move back or lower the camera so your shoulders are in frame.',
    };
  }
  if (q < 0.45) {
    return {
      state: 'warn',
      detail: 'You’re visible but the picture is weak — usually low light. Add a lamp in front of you or open the blinds.',
    };
  }
  return { state: 'pass', detail: 'Head and shoulders are clearly visible. Monitoring will work well here.' };
}

/**
 * PURE: rollup for the panel header.
 * @param {{state:string}[]} results
 */
export function summarizeChecks(results) {
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of results) counts[r.state] = (counts[r.state] || 0) + 1;
  let verdict;
  if (counts.fail) verdict = 'Something is blocking the camera — see the failed step below.';
  else if (counts.warn) verdict = 'The camera will work, with caveats — see the warnings below.';
  else verdict = 'Everything looks good — you’re ready to monitor.';
  return { ...counts, verdict };
}

const label = (id) => CHECKS.find((c) => c.id === id).label;

/**
 * Run all checks in order, skipping ones whose prerequisites failed.
 * @param {{ onCheck?: (result:object, index:number)=>void }} [opts]
 * @returns {Promise<object[]>} results in CHECKS order
 */
export async function runDiagnostics(opts = {}) {
  const onCheck = opts.onCheck || (() => {});
  const results = [];
  const push = (id, state, detail) => {
    const r = { id, label: label(id), state, detail };
    results.push(r);
    onCheck(r, results.length - 1);
    return r;
  };
  const skip = (id, why) => push(id, 'skip', why);

  // 1. secure context — getUserMedia simply doesn't exist on plain http.
  const secure = typeof isSecureContext === 'undefined' || isSecureContext;
  push('secure', secure ? 'pass' : 'fail', secure
    ? 'Running on HTTPS (or localhost).'
    : 'Camera access needs HTTPS. Open the app over https:// — on plain http the browser hides the camera entirely.');

  // 2. media API
  const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  push('media-api', hasMedia ? 'pass' : 'fail', hasMedia
    ? 'This browser supports camera capture.'
    : 'This browser can’t capture camera video. Try a current Chrome, Edge, Firefox or Safari.');

  // 3. permission state (not all browsers expose this — warn, don't fail)
  try {
    const st = await navigator.permissions.query({ name: 'camera' });
    if (st.state === 'granted') push('permission', 'pass', 'Camera permission is already granted.');
    else if (st.state === 'denied') push('permission', 'fail',
      'Camera access is blocked for this site. Click the camera/lock icon in the address bar and allow it, then reload.');
    else push('permission', 'warn', 'You’ll be asked for permission when the camera starts — choose “Allow”.');
  } catch (_) {
    push('permission', 'warn', 'Couldn’t query permission in this browser — you may be prompted when starting.');
  }

  // 4. any camera at all?
  if (!hasMedia) {
    skip('devices', 'Skipped — no camera API.');
  } else {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput').length;
      push('devices', cams > 0 ? 'pass' : 'fail', cams > 0
        ? `${cams} camera${cams === 1 ? '' : 's'} found.`
        : 'No webcam found. Plug one in (or check it isn’t disabled in system settings) and re-run.');
    } catch (_) {
      push('devices', 'warn', 'Couldn’t list devices — continuing anyway.');
    }
  }

  // 5–6. acquire + video plays
  let stream = null;
  let video = null;
  const acquireBlocked = !secure || !hasMedia;
  if (acquireBlocked) {
    skip('acquire', 'Skipped — fix the failed step above first.');
    skip('video', 'Skipped.');
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      push('acquire', 'pass', 'The camera opened.');
    } catch (err) {
      const name = err && err.name;
      const detail = name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Permission was denied. Allow camera access for this site in the address bar, then re-run.'
        : name === 'NotFoundError'
          ? 'No usable camera. Connect a webcam and re-run.'
          : name === 'NotReadableError' || name === 'AbortError'
            ? 'The camera is busy — another app (video call?) is using it. Close that app and re-run.'
            : `Camera error: ${err && err.message || err}`;
      push('acquire', 'fail', detail);
    }
    if (!stream) {
      skip('video', 'Skipped — camera didn’t open.');
    } else {
      video = document.createElement('video');
      video.muted = true;
      video.setAttribute('playsinline', '');
      video.srcObject = stream;
      const ok = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 8000);
        const done = () => { clearTimeout(t); resolve(true); };
        if (video.readyState >= 2) done();
        else video.addEventListener('loadeddata', done, { once: true });
        video.play().catch(() => { clearTimeout(t); resolve(false); });
      });
      push('video', ok ? 'pass' : 'fail', ok
        ? 'Live video is flowing.'
        : 'The camera opened but no picture arrived within 8s. Close other apps that may be holding it, or try another browser.');
      if (!ok) { stream.getTracks().forEach((t) => t.stop()); stream = null; video = null; }
    }
  }

  // 7–10. libs → backend → detector → warm-up
  let pipe = null;
  try {
    await pipeline.loadLibs();
    push('libs', 'pass', 'TensorFlow.js and pose-detection loaded from this device (no network).');
  } catch (err) {
    push('libs', 'fail', 'The vendored analysis libraries failed to load. Hard-reload (Cmd/Ctrl+Shift+R); if offline, go online once so they can be cached.');
  }
  if (results.find((r) => r.id === 'libs').state === 'fail') {
    skip('backend', 'Skipped.');
    skip('detector', 'Skipped.');
    skip('warmup', 'Skipped.');
  } else {
    try {
      pipe = await pipeline.getDetector();
      push('backend', pipe.backend === 'webgl' ? 'pass' : 'warn', pipe.backend === 'webgl'
        ? 'GPU acceleration (WebGL) is active.'
        : 'No GPU acceleration — running on CPU. Posture checks will be slower (~1/sec) but still work.');
      push('detector', 'pass', 'MoveNet loaded from the vendored model — nothing was downloaded.');
      const w = pipe.warmupMs;
      push('warmup', w < 3000 ? 'pass' : 'warn', w < 3000
        ? `Model warm-up took ${(w / 1000).toFixed(1)}s.`
        : `Model warm-up took ${(w / 1000).toFixed(1)}s — expect a slow first start on this machine (later starts are fast).`);
    } catch (err) {
      push('backend', 'warn', 'Backend check inconclusive.');
      push('detector', 'fail', 'The posture model failed to load: ' + (err && err.message || err));
      skip('warmup', 'Skipped.');
    }
  }

  // 11. can it see you?
  if (!video || !pipe) {
    skip('pose', 'Skipped — needs a live camera and a loaded model.');
  } else {
    const poses = await pipeline.estimate(video);
    const kp = poses && poses[0] && poses[0].keypoints;
    const res = classifyPoseVisibility(kp || null);
    push('pose', res.state, res.detail);
  }

  // Always release the camera (privacy light off).
  if (stream) stream.getTracks().forEach((t) => t.stop());

  return results;
}
