// posture-camera.js — optional on-device camera posture monitoring.
//
// Privacy is the whole point: TF.js + the MoveNet model are vendored locally
// (no CDN), frames are analysed in-browser and NEVER uploaded or stored, and
// tensors are released each tick. The heavy libraries are lazy-loaded only when
// the user actually opens this with the camera enabled, so the rest of the app
// stays fast.
//
// Pure verdict logic lives in posture-heuristic.js (unit-tested). This file is
// the impure shell: camera I/O, the inference loop, debouncing and UI states.

import * as store from '../core/store.js';
import { el, mount, clear, toast } from '../core/ui.js';
import * as notify from '../core/notify.js';
import { computeMetrics, makeBaseline, evaluate } from './posture-heuristic.js';

const MODEL_URL = 'vendor/movenet/model.json';
const TF_SRC = 'vendor/tfjs/tf.min.js';
const POSE_SRC = 'vendor/tfjs/pose-detection.min.js';

const INFER_MIN_MS = 160; // ~6 fps ceiling — plenty for posture
const INFER_MAX_MS = 1000;
const CPU_MIN_MS = 500; // cpu backend is slow; don't saturate the main thread
const NO_POSE_MS = 1000; // back off when nobody is in frame
const POOR_HOLD_MS = 4000; // only alert after a slump persists this long
const LOST_MS = 2500; // "can't see you" after this long with no pose
const VIDEO_START_TIMEOUT_MS = 8000;

let libsPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
async function loadLibs() {
  if (window.poseDetection && window.tf) return;
  if (!libsPromise) {
    libsPromise = (async () => {
      await loadScript(TF_SRC);
      await loadScript(POSE_SRC);
    })().catch((e) => { libsPromise = null; throw e; });
  }
  await libsPromise;
}

/**
 * Pure device assessment. A handheld is only *likely* when the UA says
 * phone/tablet AND there's a real multi-touch screen. Window width alone must
 * NEVER factor in: a narrow desktop window is not a phone, and a coarse
 * pointer can be a desktop touchscreen. The result is advisory — it renders a
 * dismissible hint, never a hard block.
 */
export function assessDevice({ ua = '', maxTouchPoints = 0 } = {}) {
  const uaPhoneOrTablet = /android|iphone|ipad|ipod|windows phone|mobile|tablet/i.test(ua);
  return { likelyHandheld: uaPhoneOrTablet && maxTouchPoints > 1 };
}

function cameraSettings() {
  return (store.get('settings') || {}).postureCamera || {};
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label || 'Timed out')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/** Resolves when the video element has real frames to analyse. */
function videoReady(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('loadeddata', resolve, { once: true });
  });
}

// --- detector cache --------------------------------------------------------
// Created once per page load and deliberately NOT disposed on teardown: cold
// start (libs + model + first inference) can take many seconds, and navigating
// back to this view should not pay that again. Camera tracks, by contrast, are
// ALWAYS stopped on teardown (privacy light off).
let detectorState = null; // { detector, backend, warmed } once resolved
let detectorPromise = null;

async function getDetector(onStage) {
  if (detectorState) return detectorState;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      onStage('libs');
      await loadLibs();
      const tf = window.tf;

      // webgl → cpu fallback. setBackend resolves false (or throws) when a
      // backend can't initialise, e.g. no GPU/WebGL in this browser.
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
      // can take several seconds. Run it once on a blank offscreen canvas so
      // the live loop starts fast and never stacks calls behind a slow first
      // tick.
      onStage('warmup');
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      try {
        await detector.estimatePoses(canvas, { maxPoses: 1, flipHorizontal: false });
      } catch (_) { /* warm-up best effort */ }

      detectorState = { detector, backend, warmed: true };
      return detectorState;
    })().catch((e) => { detectorPromise = null; throw e; });
  }
  return detectorPromise;
}

/**
 * Mount the camera section into hostEl. Returns a teardown that fully stops the
 * camera and the loop. (Named mountCamera to avoid clashing with ui.mount.)
 */
export function mountCamera(hostEl) {
  let stream = null;
  let video = null;
  let loopTimer = null;
  let disposed = false;
  let inFlight = false;
  let inferEma = 0; // exponential moving average of inference duration (ms)
  let lastSeen = 0;
  let poorSince = 0;
  let alerted = false;
  let monitoring = false;

  const statusDot = el('span', { class: 'cam-dot' });
  const statusText = el('span', { class: 'cam-status__text' }, 'Idle');
  const detail = el('p', { class: 'field__hint' }, '');
  const backendNote = el('div', {});
  const videoWrap = el('div', { class: 'cam-video', style: { display: 'none' } });
  const controls = el('div', { class: 'row', style: { marginTop: 'var(--space-3)' } });

  function setStatus(kind, text, hint) {
    statusDot.className = 'cam-dot cam-dot--' + kind;
    statusText.textContent = text;
    detail.textContent = hint || '';
  }

  function stopCamera() {
    monitoring = false;
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (video) { video.pause?.(); video.srcObject = null; }
    videoWrap.style.display = 'none';
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('off', 'Camera not supported', 'This browser can’t access a webcam.');
      return false;
    }
    setStatus('load', 'Starting camera…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setStatus('off', 'Permission denied', 'Allow camera access in your browser to use posture monitoring. Frames stay on your device.');
      } else if (err && err.name === 'NotFoundError') {
        setStatus('off', 'No camera found', 'Connect a webcam and try again.');
      } else if (err && (err.name === 'NotReadableError' || err.name === 'AbortError')) {
        setStatus('off', 'Camera is busy', 'Another app may be using the camera. Close it (video calls, camera apps) and press Start to retry.');
      } else {
        setStatus('off', 'Camera unavailable', String(err && err.message || err));
      }
      return false;
    }
    video = el('video', { autoplay: '', playsinline: '', muted: '' });
    video.srcObject = stream;
    clear(videoWrap); mount(videoWrap, video, el('div', { class: 'cam-badge' }, '🔴 on-device only'));
    try {
      // Surface failures instead of swallowing them — a silent black video is
      // the worst outcome. 8s covers slow cameras; beyond that, tell the user.
      await withTimeout(
        Promise.resolve(video.play()).then(() => videoReady(video)),
        VIDEO_START_TIMEOUT_MS,
        'Video did not start'
      );
    } catch (err) {
      stopCamera();
      setStatus('off', 'Video didn’t start', 'The camera opened but no picture arrived. Another app may be using it — close other video apps and press Start to retry.');
      return false;
    }
    return true;
  }

  async function ensureDetector() {
    try {
      const state = await getDetector((stage) => {
        if (disposed) return;
        if (stage === 'libs') setStatus('load', 'Loading analysis libraries…', 'First time only — about 3 MB, loaded from this device.');
        else if (stage === 'model') setStatus('load', 'Loading posture model…', 'First time only — about 5 MB, loaded from this device.');
        else if (stage === 'warmup') setStatus('load', 'Warming up…', 'Preparing the model. The first run can take a few seconds.');
      });
      clear(backendNote);
      if (state.backend === 'cpu') {
        mount(backendNote, el('div', { class: 'callout', style: { marginTop: 'var(--space-3)' } },
          el('p', {}, 'No GPU acceleration available in this browser, so posture checks run about once per second. Monitoring still works.')));
      }
      return state;
    } catch (err) {
      setStatus('off', 'Couldn’t load the model', 'The on-device posture model failed to load. ' + (err && err.message || ''));
      return null;
    }
  }

  // --- inference loop -------------------------------------------------------
  // Self-scheduling, never re-entrant: the next tick is queued only after the
  // current one finishes, with a cadence that adapts to how slow inference
  // actually is on this machine (EMA × 1.5). A fixed setInterval here once
  // stacked ~98 calls behind a 15s cold-start inference.
  function nextDelay(sawPose) {
    const backend = detectorState && detectorState.backend;
    let d = inferEma ? inferEma * 1.5 : INFER_MIN_MS;
    d = Math.max(INFER_MIN_MS, Math.min(INFER_MAX_MS, d));
    if (backend === 'cpu') d = Math.max(d, CPU_MIN_MS);
    if (!sawPose) d = Math.max(d, NO_POSE_MS);
    return d;
  }

  function scheduleTick(ms) {
    if (disposed || !monitoring) return;
    loopTimer = setTimeout(runTick, ms);
  }

  async function runTick() {
    if (disposed || !monitoring || inFlight) return;
    inFlight = true;
    const t0 = performance.now();
    let sawPose = false;
    try {
      sawPose = await tick();
    } catch (_) { /* skip frame */ }
    inFlight = false;
    const dt = performance.now() - t0;
    inferEma = inferEma ? inferEma * 0.7 + dt * 0.3 : dt;
    scheduleTick(nextDelay(sawPose));
  }

  /** One analysis pass. Returns true when a usable pose was seen. */
  async function tick() {
    if (disposed || !detectorState || !video || video.readyState < 2) return false;
    let poses;
    try {
      poses = await detectorState.detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false });
    } catch (_) {
      return false;
    }
    const now = Date.now();
    const kp = poses && poses[0] && poses[0].keypoints;
    const metrics = kp ? computeMetrics(kp) : null;

    if (!metrics) {
      if (now - lastSeen > LOST_MS) setStatus('warn', 'Can’t see you', 'Make sure your head and shoulders are in frame and well lit.');
      return false;
    }
    lastSeen = now;

    const baseline = cameraSettings().baseline;
    const sensitivity = cameraSettings().sensitivity ?? 0.5;
    const verdict = evaluate(metrics, baseline, sensitivity);

    if (verdict.state === 'uncalibrated') {
      setStatus('warn', 'Not calibrated', 'Sit tall and press “Calibrate” so Upright learns your good posture.');
      return true;
    }
    if (verdict.state === 'good') {
      poorSince = 0; alerted = false;
      setStatus('good', 'Good posture', 'Keep it up — shoulders relaxed, head balanced.');
    } else if (verdict.state === 'poor') {
      if (!poorSince) poorSince = now;
      const heldMs = now - poorSince;
      const label = verdict.issues.includes('slouch') ? 'Slouching' : verdict.issues.includes('leaning') ? 'Leaning' : 'Off-centre';
      setStatus('poor', label, 'Reset to your calibrated posture.');
      if (heldMs >= POOR_HOLD_MS && !alerted) {
        alerted = true;
        notify.fire('🪑 Posture check', { body: label + ' for a while — sit tall and reset.', type: 'warn' });
      }
    }
    return true;
  }

  async function beginMonitoring() {
    if (monitoring) return;
    const okCam = await startCamera();
    if (okCam === false) { renderControls(); return; }
    const state = await ensureDetector();
    if (!state) { stopCamera(); renderControls(); return; }
    if (disposed) { stopCamera(); return; }
    videoWrap.style.display = '';
    monitoring = true;
    lastSeen = Date.now();
    setStatus('good', cameraSettings().baseline ? 'Monitoring…' : 'Calibrate to begin', '');
    scheduleTick(INFER_MIN_MS);
    renderControls();
  }

  async function calibrate() {
    if (!monitoring || !detectorState || !video) { toast('Start the camera first.', { type: 'warn' }); return; }
    setStatus('load', 'Calibrating… sit tall', 'Hold a good posture for a moment.');
    const samples = [];
    for (let i = 0; i < 12; i++) {
      try {
        const poses = await detectorState.detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false });
        const m = poses && poses[0] && computeMetrics(poses[0].keypoints);
        if (m) samples.push(m);
      } catch (_) { /* skip frame */ }
      await new Promise((r) => setTimeout(r, 120));
    }
    if (samples.length < 4) { setStatus('warn', 'Calibration failed', 'I couldn’t see you clearly. Try again with more light.'); return; }
    const avg = (k) => samples.reduce((s, m) => s + m[k], 0) / samples.length;
    const baseline = makeBaseline({ verticalGap: avg('verticalGap'), lateralOffset: avg('lateralOffset'), shoulderTilt: avg('shoulderTilt') });
    store.update('settings', (s) => ({ ...s, postureCamera: { ...(s.postureCamera || {}), baseline } }));
    toast('Calibrated to your “sit tall” posture.', { type: 'success' });
    setStatus('good', 'Monitoring…', '');
  }

  function renderControls() {
    clear(controls);
    if (!monitoring) {
      mount(controls, el('button', { class: 'btn btn--primary', onClick: () => beginMonitoring() }, '🎥 Start camera'));
    } else {
      mount(controls,
        el('button', { class: 'btn btn--primary', onClick: () => calibrate() }, 'Calibrate (sit tall)'),
        el('button', { class: 'btn btn--ghost', onClick: () => { stopCamera(); setStatus('off', 'Stopped', ''); renderControls(); } }, 'Stop camera')
      );
    }
  }

  // --- initial render -------------------------------------------------------
  function renderShell() {
    clear(hostEl);
    const cam = cameraSettings();
    const card = el('section', { class: 'card' },
      el('h2', { class: 'card__title' }, 'Camera posture AI'),
      el('p', { class: 'card__subtitle' }, 'On-device webcam monitoring. Frames never leave your device and are never stored.')
    );

    if (!cam.enabled) {
      mount(card, el('div', { class: 'callout' },
        el('p', {}, 'Camera monitoring is off. '),
        el('a', { class: 'btn btn--sm', href: '#/settings', style: { marginTop: 'var(--space-2)' } }, 'Enable in Settings →')));
      mount(hostEl, card);
      return;
    }

    // Handheld advisory — never a block. Dismissing persists so it doesn't nag.
    const device = assessDevice({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0 });
    if (device.likelyHandheld && !cam.dismissedMobileAdvice) {
      mount(card, el('div', { class: 'callout callout--warn' },
        el('p', {}, 'This looks like a phone or tablet. Camera monitoring works best with a webcam at a desk — '
          + 'if you want to use it here, prop the device up at about chest height, facing you.'),
        el('div', { class: 'row', style: { marginTop: 'var(--space-3)' } },
          el('button', {
            class: 'btn btn--sm',
            onClick: () => {
              store.update('settings', (s) => ({ ...s, postureCamera: { ...(s.postureCamera || {}), dismissedMobileAdvice: true } }));
            },
          }, 'Use camera anyway'))));
      mount(hostEl, card);
      return;
    }

    const statusRow = el('div', { class: 'cam-status' }, statusDot, statusText);
    mount(card, statusRow, detail, backendNote, videoWrap, controls);
    setStatus('off', 'Idle', cam.baseline ? 'Press start to monitor your posture.' : 'Press start, then calibrate your “sit tall” posture.');
    renderControls();
    mount(hostEl, card);
  }

  renderShell();
  const unsub = store.subscribe('settings', () => { if (!monitoring) renderShell(); });

  return () => {
    disposed = true;
    stopCamera();
    // The detector is intentionally kept (module-level cache) so returning to
    // this view skips the multi-second cold start. Tracks are always stopped.
    unsub();
  };
}
