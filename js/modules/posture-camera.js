// posture-camera.js — on-device camera posture monitoring: the impure shell.
//
// Privacy is the whole point: TF.js + MoveNet are vendored locally (no CDN),
// frames are analysed in-browser and NEVER uploaded or stored — only day-level
// aggregates (postureCamLog) persist. Camera tracks are always stopped on
// teardown; the detector cache lives in cam-pipeline.js.
//
// The logic lives in pure, unit-tested modules:
//   posture-heuristic.js  metrics/verdicts/baselines
//   posture-score.js      0–100 gauge score + bands
//   cam-session.js        day aggregates (sums-and-counts)
//   alert-ladder.js       status → toast → notification escalation
//   cam-diagnostics.js    "Test my setup" checks
//
// State machine: idle → starting-camera → (loading-libs → loading-model →
// warming-up) → live(uncalibrated|monitoring|calibrating|away) → paused
// → error(kind). This file renders those states and runs the guarded,
// adaptive inference loop.

import * as store from '../core/store.js';
import { todayKey, addDays, daysAgo, diffDays } from '../core/dates.js';
import { el, mount, clear, toast, segmented } from '../core/ui.js';
import { icon } from '../core/icons.js';
import * as notify from '../core/notify.js';
import { lineChart, updatableRing } from '../core/charts.js';
import { computeMetrics, evaluate, keypointQuality, aggregateBaseline } from './posture-heuristic.js';
import * as pipeline from './cam-pipeline.js';
import { createOverlay } from './cam-overlay.js';
import { scoreFromVerdict, bandFor, makeEma } from './posture-score.js';
import * as camSession from './cam-session.js';
import { createLadder, stepLadder, snoozeUntil, SNOOZE_OPTIONS_MIN } from './alert-ladder.js';
import { runDiagnostics, summarizeChecks, CHECKS } from './cam-diagnostics.js';
import { withinActiveHours } from './posture-reminders.js';

const LOG_KEY = 'postureCamLog';
const STATE_KEY = 'reminderState'; // transient (snooze etc.) — not exported

const INFER_MIN_MS = 160; // ~6 fps ceiling — plenty for posture
const INFER_MAX_MS = 1000;
const CPU_MIN_MS = 500; // cpu backend is slow; don't saturate the main thread
const NO_POSE_MS = 1000; // back off between checks when nobody is in frame
const AWAY_MS = 60000; // no pose this long → user is away (not "can't see you")
const LOST_MS = 2500; // brief no-pose → "can't see you" hint
const FLUSH_MS = 30000; // write session aggregates at most every 30s
const HIDDEN_STOP_MS = 10 * 60 * 1000; // hidden tab this long → release camera
const VIDEO_START_TIMEOUT_MS = 8000;
const RECAL_NUDGE_DAYS = 30;
const KEEP_DAYS = 180;
const CALIB_SAMPLES = 16;
const CALIB_MIN_QUALITY = 0.35;

function cameraSettings() {
  return (store.get('settings') || {}).postureCamera || {};
}
function reminderSettings() {
  return (store.get('settings') || {}).reminders || {};
}
function flareActive() {
  // Phase 6 gives flares a full view; the ladder cap starts respecting them now.
  return (store.get('flareLog') || []).some((f) => f && !f.endedAt);
}
function snoozedUntilMs() {
  const st = store.get(STATE_KEY) || {};
  return st.camSnoozedUntil || null;
}
function setSnooze(untilMs) {
  store.update(STATE_KEY, (st) => ({ ...(st || {}), camSnoozedUntil: untilMs }));
}

/**
 * Pure device assessment. A handheld is only *likely* when the UA says
 * phone/tablet AND there's a real multi-touch screen. Window width alone must
 * NEVER factor in: a narrow desktop window is not a phone. The result is
 * advisory — a dismissible hint, never a hard block.
 */
export function assessDevice({ ua = '', maxTouchPoints = 0 } = {}) {
  const uaPhoneOrTablet = /android|iphone|ipad|ipod|windows phone|mobile|tablet/i.test(ua);
  return { likelyHandheld: uaPhoneOrTablet && maxTouchPoints > 1 };
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

function videoReady(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('loadeddata', resolve, { once: true });
  });
}

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Today's summary for the dashboard tile (null when nothing was monitored). */
export function getSummary() {
  const day = (store.get(LOG_KEY) || {})[todayKey()];
  if (!day) return null;
  return camSession.summarizeDay(day);
}

/**
 * Mount the camera section into hostEl. Returns a teardown that fully stops
 * the camera and the loop (the cached detector survives — see cam-pipeline).
 */
export function mountCamera(hostEl) {
  // --- machine state ---------------------------------------------------------
  let state = 'idle'; // idle|starting|live|paused|error
  let liveMode = 'uncalibrated'; // uncalibrated|monitoring|calibrating|away
  let disposed = false;
  let stream = null;
  let video = null;
  let overlay = null;
  let loopTimer = null;
  let inFlight = false;
  let inferEma = 0; // EMA of inference duration (ms)
  let lastPoseAt = 0;
  let lastTickAt = 0;
  let lastFlushAt = 0;
  let pausedReason = null;
  let hiddenStopTimer = null;
  let sess = camSession.createSession();
  let ladder = createLadder();
  const scoreEma = makeEma(0.35);

  // --- static UI nodes ---------------------------------------------------------
  const statusDot = el('span', { class: 'cam-dot' });
  const statusText = el('span', { class: 'cam-status__text' }, 'Idle');
  const detail = el('p', { class: 'field__hint' }, '');
  const backendNote = el('div', {});
  const videoWrap = el('div', { class: 'cam-video', style: { display: 'none' } });
  const gauge = updatableRing({ value: 0, max: 100, size: 116, stroke: 10, label: 'Posture score', center: '—', sub: 'score', animate: true });
  const gaugeWrap = el('div', { class: 'cam-gauge', style: { display: 'none' } }, gauge.svg);
  const snoozeRow = el('div', { class: 'cam-snooze', style: { display: 'none' } });
  const stage = el('div', { class: 'cam-stage' }, videoWrap, el('div', { class: 'cam-side' }, gaugeWrap, snoozeRow));
  const controls = el('div', { class: 'row', style: { marginTop: 'var(--space-3)' } });
  const profileRow = el('div', { class: 'cam-profile' });
  const diagHost = el('div', {});

  function setStatus(kind, text, hint) {
    statusDot.className = 'cam-dot cam-dot--' + kind;
    statusText.textContent = text;
    detail.textContent = hint || '';
  }

  // --- profiles ---------------------------------------------------------------
  function activeProfileName() {
    return cameraSettings().activeProfile === 'standing' ? 'standing' : 'sitting';
  }
  function profileData(name) {
    const cam = cameraSettings();
    const prof = (cam.profiles || {})[name] || {};
    if (prof.baseline) return prof;
    // Legacy pre-v2 calibration lived at postureCamera.baseline (sitting).
    if (name === 'sitting' && cam.baseline) return { baseline: cam.baseline, calibratedAt: null };
    return { baseline: null, calibratedAt: null };
  }
  function activeBaseline() {
    return profileData(activeProfileName()).baseline;
  }

  function renderProfileRow() {
    clear(profileRow);
    const name = activeProfileName();
    const prof = profileData(name);
    const seg = segmented({
      ariaLabel: 'Posture profile',
      value: name,
      options: [
        { value: 'sitting', label: 'Sitting' },
        { value: 'standing', label: 'Standing' },
      ],
      onChange: (v) => {
        store.update('settings', (s) => ({ ...s, postureCamera: { ...(s.postureCamera || {}), activeProfile: v } }));
        renderProfileRow();
        scoreEma.reset();
        if (state === 'live') {
          const b = activeBaseline();
          liveMode = b ? 'monitoring' : 'uncalibrated';
          setStatus(b ? 'good' : 'warn', b ? 'Monitoring…' : 'Not calibrated',
            b ? `Switched to your ${v} baseline.` : `No ${v} baseline yet — press Calibrate while ${v === 'sitting' ? 'sitting' : 'standing'} tall.`);
        }
      },
    });
    let ageText = 'Not calibrated yet.';
    let nudge = null;
    if (prof.baseline) {
      if (prof.calibratedAt) {
        const days = daysAgo(prof.calibratedAt.slice(0, 10));
        ageText = days <= 0 ? 'Calibrated today.' : days === 1 ? 'Calibrated yesterday.' : `Calibrated ${days} days ago.`;
        if (days > RECAL_NUDGE_DAYS) nudge = ' Worth recalibrating — posture baselines drift.';
      } else {
        ageText = 'Calibrated (before profiles existed).';
      }
    }
    mount(profileRow,
      seg.root,
      el('span', { class: 'field__hint', style: { marginTop: 0 } }, ageText, nudge ? el('strong', {}, nudge) : null)
    );
  }

  // --- snooze -------------------------------------------------------------------
  function renderSnooze() {
    clear(snoozeRow);
    const until = snoozedUntilMs();
    const now = Date.now();
    if (until && now < until) {
      mount(snoozeRow,
        el('span', { class: 'field__hint', style: { marginTop: 0 } }, `Alerts snoozed until ${fmtClock(until)}`),
        el('button', { class: 'btn btn--sm', onClick: () => { setSnooze(null); renderSnooze(); } }, 'Resume alerts'));
    } else {
      mount(snoozeRow,
        el('span', { class: 'field__hint', style: { marginTop: 0 } }, 'Snooze alerts:'),
        ...SNOOZE_OPTIONS_MIN.map((min) => el('button', {
          class: 'btn btn--sm',
          onClick: () => { setSnooze(snoozeUntil(Date.now(), min)); renderSnooze(); toast(`Camera alerts snoozed for ${min >= 60 ? '1 hour' : min + ' min'}.`, { type: 'info' }); },
        }, min >= 60 ? '1h' : `${min}m`)));
    }
  }

  // --- session persistence --------------------------------------------------------
  function flushSession(opts = {}) {
    const delta = camSession.takeFlush(sess, opts);
    if (!delta) return;
    const day = todayKey();
    store.update(LOG_KEY, (log) => ({ ...(log || {}), [day]: camSession.mergeDay((log || {})[day], delta) }));
    lastFlushAt = Date.now();
  }

  // --- camera / loop ------------------------------------------------------------
  function stopLoop() {
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  }

  function stopCamera(finalStatus) {
    const wasLive = state === 'live' || state === 'paused';
    stopLoop();
    if (wasLive) flushSession({ final: true, endedAt: new Date().toISOString() });
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    if (video) { video.pause?.(); video.srcObject = null; video = null; }
    if (overlay) { overlay.clear(); overlay = null; }
    videoWrap.style.display = 'none';
    gaugeWrap.style.display = 'none';
    snoozeRow.style.display = 'none';
    state = 'idle';
    ladder = createLadder();
    scoreEma.reset();
    sess = camSession.createSession();
    if (finalStatus) setStatus('off', finalStatus.text || 'Stopped', finalStatus.hint || '');
    renderControls();
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
      state = 'error';
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setStatus('off', 'Permission denied', 'Allow camera access in your browser to use posture monitoring. Frames stay on your device.');
      } else if (err && err.name === 'NotFoundError') {
        setStatus('off', 'No camera found', 'Connect a webcam and try again — or run “Test my setup” below.');
      } else if (err && (err.name === 'NotReadableError' || err.name === 'AbortError')) {
        setStatus('off', 'Camera is busy', 'Another app may be using the camera. Close it (video calls, camera apps) and press Start to retry.');
      } else {
        setStatus('off', 'Camera unavailable', String(err && err.message || err));
      }
      return false;
    }
    // A yanked USB webcam / OS-level revocation fires 'ended' on the track.
    const track = stream.getVideoTracks()[0];
    if (track) track.addEventListener('ended', () => {
      if (disposed || state === 'idle') return;
      stopCamera({ text: 'Camera disconnected', hint: 'The camera stopped supplying video. Reconnect it and press Start.' });
    });

    video = el('video', { autoplay: '', playsinline: '', muted: '' });
    video.srcObject = stream;
    const canvas = el('canvas', { class: 'cam-overlay', 'aria-hidden': 'true' });
    overlay = createOverlay(canvas);
    clear(videoWrap);
    mount(videoWrap, video, canvas, el('div', { class: 'cam-badge' }, '🔴 on-device only'));
    try {
      // Surface failures instead of swallowing them — a silent black video is
      // the worst outcome. 8s covers slow cameras; beyond that, tell the user.
      await withTimeout(
        Promise.resolve(video.play()).then(() => videoReady(video)),
        VIDEO_START_TIMEOUT_MS,
        'Video did not start'
      );
    } catch (_) {
      stopCamera({ text: 'Video didn’t start', hint: 'The camera opened but no picture arrived. Another app may be using it — close other video apps and press Start to retry.' });
      state = 'error';
      return false;
    }
    return true;
  }

  async function ensureDetector() {
    try {
      const pipe = await pipeline.getDetector((stage) => {
        if (disposed) return;
        if (stage === 'libs') setStatus('load', 'Loading analysis libraries…', 'First time only — about 3 MB, loaded from this device.');
        else if (stage === 'model') setStatus('load', 'Loading posture model…', 'First time only — about 5 MB, loaded from this device.');
        else if (stage === 'warmup') setStatus('load', 'Warming up…', 'Preparing the model. The first run can take a few seconds.');
      });
      clear(backendNote);
      if (pipe.backend === 'cpu') {
        mount(backendNote, el('div', { class: 'callout', style: { marginTop: 'var(--space-3)' } },
          el('p', {}, 'No GPU acceleration available in this browser, so posture checks run about once per second. Monitoring still works.')));
      }
      return pipe;
    } catch (err) {
      state = 'error';
      setStatus('off', 'Couldn’t load the model', 'The on-device posture model failed to load. ' + (err && err.message || '') + ' Try “Test my setup” below.');
      return null;
    }
  }

  // Self-scheduling, never re-entrant: the next tick is queued only after the
  // current one finishes, with a cadence adapted to real inference time
  // (EMA × 1.5). A fixed setInterval here once stacked ~98 calls behind a
  // 15-second cold-start inference.
  function nextDelay(sawPose) {
    const backend = pipeline.activeBackend();
    let d = inferEma ? inferEma * 1.5 : INFER_MIN_MS;
    d = Math.max(INFER_MIN_MS, Math.min(INFER_MAX_MS, d));
    if (backend === 'cpu') d = Math.max(d, CPU_MIN_MS);
    if (!sawPose) d = Math.max(d, NO_POSE_MS);
    return d;
  }

  function scheduleTick(ms) {
    if (disposed || state !== 'live') return;
    loopTimer = setTimeout(runTick, ms);
  }

  async function runTick() {
    if (disposed || state !== 'live' || inFlight || liveMode === 'calibrating') return;
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
    if (!video || video.readyState < 2) return false;
    const poses = await pipeline.estimate(video);
    const now = Date.now();
    const dtMs = lastTickAt ? now - lastTickAt : 0;
    lastTickAt = now;

    const kp = poses && poses[0] && poses[0].keypoints;
    const metrics = kp ? computeMetrics(kp) : null;
    const baseline = activeBaseline();
    const cam = cameraSettings();
    const sensitivity = cam.sensitivity ?? 0.5;

    // ---- no pose: brief → hint; sustained → away ------------------------------
    if (!metrics) {
      if (overlay) overlay.clear();
      if (lastPoseAt && now - lastPoseAt >= AWAY_MS) {
        if (liveMode !== 'away') {
          liveMode = 'away';
          if (baseline) camSession.markAway(sess);
          setStatus('warn', 'Away', 'Monitoring is paused until you’re back in frame. No alerts while you’re away.');
          gauge.set(0, { center: '—', sub: 'away', color: 'var(--color-text-faint)' });
        }
        if (baseline) camSession.accumulate(sess, 'away', dtMs);
      } else if (now - lastPoseAt > LOST_MS && liveMode !== 'away') {
        setStatus('warn', 'Can’t see you', 'Make sure your head and shoulders are in frame and well lit.');
      }
      ladder = stepLadder(ladder, { state: 'away', now }).ladder;
      maybeFlush(now);
      return false;
    }

    // ---- pose present -----------------------------------------------------------
    if (liveMode === 'away') {
      liveMode = baseline ? 'monitoring' : 'uncalibrated';
      setStatus('good', 'Welcome back', 'Monitoring resumed.');
    }
    lastPoseAt = now;

    const verdict = evaluate(metrics, baseline, sensitivity);

    if (verdict.state === 'uncalibrated') {
      liveMode = 'uncalibrated';
      setStatus('warn', 'Not calibrated', `${activeProfileName() === 'sitting' ? 'Sit' : 'Stand'} tall and press “Calibrate” so Upright learns your good posture.`);
      if (overlay && cam.overlay !== false) overlay.draw(kp, 'none', video.videoWidth, video.videoHeight);
      gauge.set(0, { center: '—', sub: 'calibrate', color: 'var(--color-info)' });
      return true;
    }
    liveMode = 'monitoring';

    // Score gauge (EMA-smoothed so it reads calm, not jittery).
    const raw = scoreFromVerdict(verdict, sensitivity);
    const smoothed = scoreEma.push(raw);
    const band = smoothed == null ? 'none' : bandFor(smoothed);
    if (smoothed != null) {
      const color = band === 'good' ? 'var(--color-success)' : band === 'ok' ? 'var(--color-warn)' : 'var(--color-danger)';
      gauge.set(smoothed, { center: String(Math.round(smoothed)), sub: band === 'good' ? 'good' : band === 'ok' ? 'drifting' : 'slouching', color });
    }

    if (overlay && cam.overlay !== false) overlay.draw(kp, band, video.videoWidth, video.videoHeight);

    // Session accounting + alert ladder.
    camSession.accumulate(sess, verdict.state, dtMs, raw);

    if (verdict.state === 'good') {
      setStatus('good', 'Good posture', 'Keep it up — shoulders relaxed, head balanced.');
    }

    const frozen = !withinActiveHours(new Date(now), reminderSettings()) || flareActive();
    const step = stepLadder(ladder, { state: verdict.state, now, snoozedUntil: snoozedUntilMs(), frozen });
    ladder = step.ladder;

    if (verdict.state === 'poor') {
      const label = verdict.issues.includes('slouch') ? 'Slouching' : verdict.issues.includes('leaning') ? 'Leaning' : 'Off-centre';
      setStatus('poor', label, step.heldMs >= 4000 ? `For ${Math.round(step.heldMs / 1000)}s — reset to your calibrated posture.` : 'Reset to your calibrated posture.');
      if (step.fire === 'toast') {
        toast(`${label} for ${Math.round(step.heldMs / 1000)}s — sit tall and reset.`, {
          type: 'warn',
          action: { label: 'Snooze 5m', onClick: () => { setSnooze(snoozeUntil(Date.now(), 5)); renderSnooze(); } },
        });
      } else if (step.fire === 'notify') {
        notify.fire('🪑 Posture check', { body: `${label} for a while — sit tall and reset.`, type: 'warn' });
        if ((cam.alerts || {}).sound) notify.chime();
      }
    }

    maybeFlush(now);
    return true;
  }

  function maybeFlush(now) {
    if (!lastFlushAt) lastFlushAt = now;
    if (now - lastFlushAt >= FLUSH_MS) flushSession();
  }

  async function beginMonitoring() {
    if (state !== 'idle' && state !== 'error') return;
    state = 'starting';
    renderControls();
    const okCam = await startCamera();
    if (!okCam) { state = 'error'; renderControls(); return; }
    const pipe = await ensureDetector();
    if (!pipe) { stopCamera(); state = 'error'; renderControls(); return; }
    if (disposed) { stopCamera(); return; }

    state = 'live';
    videoWrap.style.display = '';
    gaugeWrap.style.display = '';
    snoozeRow.style.display = '';
    renderSnooze();
    lastPoseAt = Date.now();
    lastTickAt = 0;
    lastFlushAt = Date.now();
    sess = camSession.createSession();
    ladder = createLadder();
    scoreEma.reset();
    const baseline = activeBaseline();
    liveMode = baseline ? 'monitoring' : 'uncalibrated';
    setStatus(baseline ? 'good' : 'warn', baseline ? 'Monitoring…' : 'Calibrate to begin',
      baseline ? '' : `${activeProfileName() === 'sitting' ? 'Sit' : 'Stand'} tall, then press Calibrate.`);
    scheduleTick(INFER_MIN_MS);
    renderControls();
  }

  function pauseMonitoring(reason) {
    if (state !== 'live') return;
    stopLoop();
    flushSession();
    state = 'paused';
    pausedReason = reason;
    setStatus('warn', 'Paused', reason === 'hidden' ? 'Tab is in the background — monitoring resumes when you return.' : '');
    renderControls();
  }

  function resumeMonitoring() {
    if (state !== 'paused') return;
    state = 'live';
    pausedReason = null;
    lastTickAt = 0;
    lastPoseAt = Date.now();
    setStatus('good', 'Monitoring…', '');
    scheduleTick(INFER_MIN_MS);
    renderControls();
  }

  // --- guided calibration ---------------------------------------------------------
  async function calibrate() {
    if (state !== 'live' || !video) { toast('Start the camera first.', { type: 'warn' }); return; }
    const profName = activeProfileName();
    const posture = profName === 'sitting' ? 'Sit' : 'Stand';
    const prevMode = liveMode;
    liveMode = 'calibrating';
    stopLoop();
    renderControls();

    // 3-2-1 countdown so the user settles into an honest tall posture.
    for (const n of [3, 2, 1]) {
      if (disposed || state !== 'live') return;
      setStatus('load', `Calibrating in ${n}…`, `${posture} tall, shoulders relaxed, eyes ahead.`);
      gauge.set(((4 - n) / 3) * 100, { center: String(n), sub: 'get ready', color: 'var(--color-info)' });
      await new Promise((r) => setTimeout(r, 800));
    }

    const samples = [];
    let attempts = 0;
    let lowQuality = 0;
    while (attempts < CALIB_SAMPLES && !disposed && state === 'live') {
      attempts += 1;
      const poses = await pipeline.estimate(video);
      const kp = poses && poses[0] && poses[0].keypoints;
      if (kp) {
        const q = keypointQuality(kp);
        if (q >= CALIB_MIN_QUALITY) {
          const m = computeMetrics(kp);
          if (m) samples.push(m);
        } else {
          lowQuality += 1;
        }
      }
      setStatus('load', 'Hold it…', `Capturing your ${profName} baseline (${samples.length}/${CALIB_SAMPLES}).`);
      gauge.set((samples.length / CALIB_SAMPLES) * 100, { center: String(samples.length), sub: `of ${CALIB_SAMPLES}`, color: 'var(--color-info)' });
      await new Promise((r) => setTimeout(r, 150));
    }
    if (disposed || state !== 'live') return;

    const agg = aggregateBaseline(samples);
    if (!agg.ok) {
      let msg;
      if (agg.reason === 'moved') {
        msg = 'You moved during capture. Settle into position first, then hold still for about three seconds.';
      } else if (lowQuality > attempts / 2) {
        msg = 'I could see something, but not clearly — usually low light. Add a lamp in front of you and try again.';
      } else {
        msg = 'I couldn’t see your head and shoulders. Face the camera, 50–100 cm away, and try again.';
      }
      setStatus('warn', 'Calibration failed', msg);
      gauge.set(0, { center: '×', sub: 'try again', color: 'var(--color-danger)' });
      liveMode = prevMode;
      scheduleTick(INFER_MIN_MS);
      renderControls();
      return;
    }

    const calibratedAt = new Date().toISOString();
    store.update('settings', (s) => {
      const cam = { ...(s.postureCamera || {}) };
      const profiles = { ...(cam.profiles || {}) };
      profiles[profName] = { baseline: agg.baseline, calibratedAt };
      cam.profiles = profiles;
      // Keep the legacy field in sync for the sitting profile so pre-v2
      // backups/downgrades still see a calibration.
      if (profName === 'sitting') cam.baseline = agg.baseline;
      return { ...s, postureCamera: cam };
    });
    toast(`Calibrated to your “${profName === 'sitting' ? 'sit' : 'stand'} tall” posture.`, { type: 'success' });
    liveMode = 'monitoring';
    scoreEma.reset();
    setStatus('good', 'Monitoring…', '');
    renderProfileRow();
    scheduleTick(INFER_MIN_MS);
    renderControls();
  }

  // --- controls -----------------------------------------------------------------
  function renderControls() {
    clear(controls);
    if (state === 'idle' || state === 'error') {
      mount(controls, el('button', { class: 'btn btn--primary', onClick: () => beginMonitoring() },
        icon('video', { size: 18 }), state === 'error' ? 'Retry' : 'Start camera'));
    } else if (state === 'starting') {
      mount(controls, el('button', { class: 'btn', disabled: true }, 'Starting…'));
    } else if (state === 'paused') {
      mount(controls,
        el('button', { class: 'btn btn--primary', onClick: () => resumeMonitoring() }, icon('play', { size: 16 }), 'Resume'),
        el('button', { class: 'btn btn--ghost', onClick: () => stopCamera({ text: 'Stopped' }) }, icon('stop', { size: 16 }), 'Stop camera'));
    } else if (state === 'live') {
      const calibrating = liveMode === 'calibrating';
      mount(controls,
        el('button', { class: 'btn btn--primary', disabled: calibrating, onClick: () => calibrate() },
          icon('target', { size: 16 }), calibrating ? 'Calibrating…' : `Calibrate (${activeProfileName()})`),
        el('button', { class: 'btn btn--ghost', disabled: calibrating, onClick: () => pauseMonitoring('user') }, icon('pause', { size: 16 }), 'Pause'),
        el('button', { class: 'btn btn--ghost', disabled: calibrating, onClick: () => stopCamera({ text: 'Stopped' }) }, icon('stop', { size: 16 }), 'Stop camera'));
    }
  }

  // --- diagnostics panel ------------------------------------------------------------
  function renderDiagnostics(autoRun) {
    clear(diagHost);
    const list = el('div', { class: 'diag-list' });
    const summary = el('p', { class: 'field__hint' }, 'Eleven quick checks, from browser support down to “can the model actually see you”. The camera light will blink on briefly.');
    let running = false;
    const runBtn = el('button', {
      class: 'btn btn--sm',
      onClick: async () => {
        if (running) return;
        running = true;
        runBtn.disabled = true;
        clear(list);
        const rows = new Map();
        for (const c of CHECKS) {
          const row = el('div', { class: 'diag-row diag-row--pending' },
            el('span', { class: 'diag-row__state' }, '·'),
            el('span', { class: 'diag-row__label' }, c.label),
            el('span', { class: 'diag-row__detail' }, ''));
          rows.set(c.id, row);
          list.appendChild(row);
        }
        const results = await runDiagnostics({
          onCheck: (r) => {
            const row = rows.get(r.id);
            if (!row) return;
            row.className = `diag-row diag-row--${r.state}`;
            clear(row);
            const glyph = r.state === 'pass' ? icon('check', { size: 16 }) : r.state === 'warn' ? icon('alert-triangle', { size: 16 }) : r.state === 'fail' ? icon('x', { size: 16 }) : icon('minus', { size: 16 });
            mount(row,
              el('span', { class: 'diag-row__state' }, glyph),
              el('span', { class: 'diag-row__label' }, r.label),
              el('span', { class: 'diag-row__detail' }, r.detail));
          },
        });
        const sum = summarizeChecks(results);
        summary.textContent = sum.verdict;
        running = false;
        runBtn.disabled = false;
        runBtn.replaceChildren(icon('refresh', { size: 14 }), ' Run again');
      },
    }, icon('play', { size: 14 }), ' Run checks');

    const details = el('details', { class: 'cam-diag' },
      el('summary', {}, icon('shield', { size: 16 }), ' Test my setup'),
      el('div', { class: 'cam-diag__body' }, summary, runBtn, list));
    mount(diagHost, details);
    if (autoRun) {
      details.open = true;
      // Defer so the panel paints before the camera light blinks on.
      setTimeout(() => runBtn.click(), 60);
    }
  }

  // --- history card --------------------------------------------------------------
  const historyHost = el('div', {});
  function renderHistory() {
    clear(historyHost);
    const log = store.get(LOG_KEY) || {};
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const k = addDays(todayKey(), -i);
      days.push({ key: k, day: log[k] });
    }
    const any = days.some((d) => d.day && d.day.monitoredMs > 0);
    if (!any) return; // nothing yet — the card appears after the first session
    const values = days.map((d) => {
      const s = camSession.summarizeDay(d.day);
      return d.day && d.day.monitoredMs > 0 ? s.pctGood : null;
    });
    const labels = days.map((d, i) => (i % 2 === 0 ? d.key.slice(5).replace('-', '/') : ''));
    const totals = days.reduce((acc, d) => {
      if (!d.day) return acc;
      acc.monitoredMs += d.day.monitoredMs || 0;
      acc.slouchEvents += d.day.slouchEvents || 0;
      return acc;
    }, { monitoredMs: 0, slouchEvents: 0 });
    const hours = totals.monitoredMs / 3600000;
    mount(historyHost, el('section', { class: 'card' },
      el('h2', { class: 'card__title' }, 'Camera history'),
      el('p', { class: 'card__subtitle' }, `Share of monitored time with good posture — last 14 days. ${hours >= 0.1 ? `${hours.toFixed(1)}h monitored, ${totals.slouchEvents} slouch alerts.` : ''}`),
      lineChart({
        series: [{ values, color: 'var(--color-primary)', label: '% good', fill: true }],
        labels, yMin: 0, yMax: 100, height: 180,
        ariaLabel: 'Camera posture history',
        interactive: true, gradientFill: true, markers: 'auto',
        tipFormat: (v) => `${Math.round(v)}% good`,
      })
    ));
  }

  // --- visibility / lifecycle -------------------------------------------------------
  function onVisibility() {
    if (document.hidden) {
      if (state === 'live') {
        pauseMonitoring('hidden');
        hiddenStopTimer = setTimeout(() => {
          if (!disposed && state === 'paused') stopCamera({ text: 'Stopped', hint: 'Camera released after 10 minutes in the background.' });
        }, HIDDEN_STOP_MS);
      }
    } else {
      if (hiddenStopTimer) { clearTimeout(hiddenStopTimer); hiddenStopTimer = null; }
      if (state === 'paused' && pausedReason === 'hidden') resumeMonitoring();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  // --- shell render ---------------------------------------------------------------
  function renderShell() {
    clear(hostEl);
    const cam = cameraSettings();
    const cardEl = el('section', { class: 'card' },
      el('h2', { class: 'card__title' }, 'Camera posture AI'),
      el('p', { class: 'card__subtitle' }, 'On-device webcam monitoring. Frames never leave your device and are never stored.')
    );

    if (!cam.enabled) {
      mount(cardEl, el('div', { class: 'callout' },
        el('p', {}, 'Camera monitoring is off. '),
        el('a', { class: 'btn btn--sm', href: '#/settings', style: { marginTop: 'var(--space-2)' } }, 'Enable in Settings →')));
      mount(hostEl, cardEl);
      return;
    }

    // Handheld advisory — never a block. Dismissing persists so it doesn't nag.
    const device = assessDevice({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0 });
    if (device.likelyHandheld && !cam.dismissedMobileAdvice) {
      mount(cardEl, el('div', { class: 'callout callout--warn' },
        el('p', {}, 'This looks like a phone or tablet. Camera monitoring works best with a webcam at a desk — '
          + 'if you want to use it here, prop the device up at about chest height, facing you.'),
        el('div', { class: 'row', style: { marginTop: 'var(--space-3)' } },
          el('button', {
            class: 'btn btn--sm',
            onClick: () => {
              store.update('settings', (s) => ({ ...s, postureCamera: { ...(s.postureCamera || {}), dismissedMobileAdvice: true } }));
            },
          }, 'Use camera anyway'))));
      mount(hostEl, cardEl);
      return;
    }

    const statusRow = el('div', { class: 'cam-status' }, statusDot, statusText);
    renderProfileRow();
    const wantDiagAutorun = /[?&]diag=1/.test(location.hash);
    renderDiagnostics(wantDiagAutorun);
    mount(cardEl, statusRow, detail, backendNote, stage, controls, profileRow, diagHost);
    setStatus('off', 'Idle', activeBaseline() ? 'Press start to monitor your posture.' : 'Press start, then calibrate your “sit tall” posture.');
    renderControls();
    mount(hostEl, cardEl, historyHost);
    renderHistory();
  }

  // Storage hygiene: keep ~6 months of camera aggregates.
  store.update(LOG_KEY, (log) => camSession.pruneLog(log || {}, todayKey(), KEEP_DAYS, diffDays));

  renderShell();
  const unsubSettings = store.subscribe('settings', () => { if (state === 'idle') renderShell(); });
  const unsubLog = store.subscribe(LOG_KEY, () => { if (state === 'idle') renderHistory(); });

  return () => {
    disposed = true;
    if (hiddenStopTimer) clearTimeout(hiddenStopTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    stopCamera();
    // The detector cache in cam-pipeline is intentionally kept — returning to
    // this view skips the multi-second cold start. Tracks are always stopped.
    unsubSettings();
    unsubLog();
  };
}
