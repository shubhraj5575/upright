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

const INFER_MS = 160; // ~6 fps — plenty for posture, easy on the CPU/GPU
const POOR_HOLD_MS = 4000; // only alert after a slump persists this long
const LOST_MS = 2500; // "can't see you" after this long with no pose

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

function isProbablyMobile() {
  return matchMedia('(max-width: 640px)').matches || matchMedia('(pointer: coarse)').matches;
}

function cameraSettings() {
  return (store.get('settings') || {}).postureCamera || {};
}

/**
 * Mount the camera section into hostEl. Returns a teardown that fully stops the
 * camera, the loop, and releases the detector. (Named mountCamera to avoid
 * clashing with ui.mount imported above.)
 */
export function mountCamera(hostEl) {
  let stream = null;
  let detector = null;
  let video = null;
  let loopTimer = null;
  let disposed = false;
  let lastSeen = 0;
  let poorSince = 0;
  let alerted = false;
  let monitoring = false;

  const statusDot = el('span', { class: 'cam-dot' });
  const statusText = el('span', { class: 'cam-status__text' }, 'Idle');
  const detail = el('p', { class: 'field__hint' }, '');
  const videoWrap = el('div', { class: 'cam-video', style: { display: 'none' } });
  const controls = el('div', { class: 'row', style: { marginTop: 'var(--space-3)' } });

  function setStatus(kind, text, hint) {
    statusDot.className = 'cam-dot cam-dot--' + kind;
    statusText.textContent = text;
    detail.textContent = hint || '';
  }

  function stopCamera() {
    monitoring = false;
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
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
      } else {
        setStatus('off', 'Camera unavailable', String(err && err.message || err));
      }
      return false;
    }
    video = el('video', { autoplay: '', playsinline: '', muted: '' });
    video.srcObject = stream;
    clear(videoWrap); mount(videoWrap, video, el('div', { class: 'cam-badge' }, '🔴 on-device only'));
    await video.play().catch(() => {});
    return true;
  }

  async function ensureDetector() {
    if (detector) return true;
    setStatus('load', 'Loading posture model…', 'First time only — about 5 MB, loaded from this device.');
    try {
      await loadLibs();
      await window.tf.setBackend('webgl');
      await window.tf.ready();
      detector = await window.poseDetection.createDetector(
        window.poseDetection.SupportedModels.MoveNet,
        { modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, modelUrl: MODEL_URL }
      );
      return true;
    } catch (err) {
      setStatus('off', 'Couldn’t load the model', 'The on-device posture model failed to load. ' + (err && err.message || ''));
      return false;
    }
  }

  async function tick() {
    if (disposed || !detector || !video || video.readyState < 2) return;
    let poses;
    try {
      poses = await detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false });
    } catch (_) {
      return;
    }
    const now = Date.now();
    const kp = poses && poses[0] && poses[0].keypoints;
    const metrics = kp ? computeMetrics(kp) : null;

    if (!metrics) {
      if (now - lastSeen > LOST_MS) setStatus('warn', 'Can’t see you', 'Make sure your head and shoulders are in frame and well lit.');
      return;
    }
    lastSeen = now;

    const baseline = cameraSettings().baseline;
    const sensitivity = cameraSettings().sensitivity ?? 0.5;
    const verdict = evaluate(metrics, baseline, sensitivity);

    if (verdict.state === 'uncalibrated') {
      setStatus('warn', 'Not calibrated', 'Sit tall and press “Calibrate” so Upright learns your good posture.');
      return;
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
  }

  async function beginMonitoring() {
    if (monitoring) return;
    const okCam = await startCamera();
    if (!okCam) return;
    const okModel = await ensureDetector();
    if (!okModel) { stopCamera(); return; }
    videoWrap.style.display = '';
    monitoring = true;
    lastSeen = Date.now();
    setStatus('good', cameraSettings().baseline ? 'Monitoring…' : 'Calibrate to begin', '');
    loopTimer = setInterval(tick, INFER_MS);
    renderControls();
  }

  async function calibrate() {
    if (!monitoring || !detector || !video) { toast('Start the camera first.', { type: 'warn' }); return; }
    setStatus('load', 'Calibrating… sit tall', 'Hold a good posture for a moment.');
    const samples = [];
    for (let i = 0; i < 12; i++) {
      try {
        const poses = await detector.estimatePoses(video, { maxPoses: 1, flipHorizontal: false });
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
    const enabled = !!cameraSettings().enabled;
    const card = el('section', { class: 'card' },
      el('h2', { class: 'card__title' }, 'Camera posture AI'),
      el('p', { class: 'card__subtitle' }, 'On-device webcam monitoring. Frames never leave your device and are never stored.')
    );

    if (!enabled) {
      mount(card, el('div', { class: 'callout' },
        el('p', {}, 'Camera monitoring is off. '),
        el('a', { class: 'btn btn--sm', href: '#/settings', style: { marginTop: 'var(--space-2)' } }, 'Enable in Settings →')));
      mount(hostEl, card);
      return;
    }

    if (isProbablyMobile()) {
      mount(card, el('div', { class: 'callout callout--warn' },
        el('p', {}, 'Camera posture AI is designed for a desktop/laptop webcam while you sit at a desk. '
          + 'On a phone it’s impractical, so it’s hidden here. Use the quick check-ins above instead.')));
      mount(hostEl, card);
      return;
    }

    const statusRow = el('div', { class: 'cam-status' }, statusDot, statusText);
    mount(card, statusRow, detail, videoWrap, controls);
    setStatus('off', 'Idle', cameraSettings().baseline ? 'Press start to monitor your posture.' : 'Press start, then calibrate your “sit tall” posture.');
    renderControls();
    mount(hostEl, card);
  }

  renderShell();
  const unsub = store.subscribe('settings', () => { if (!monitoring) renderShell(); });

  return () => {
    disposed = true;
    stopCamera();
    if (detector && detector.dispose) { try { detector.dispose(); } catch (_) {} }
    detector = null;
    unsub();
  };
}
