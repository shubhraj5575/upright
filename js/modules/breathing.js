// breathing.js — a box-breathing (4-4-4-4) overlay. Two minutes of slow
// breathing is a genuinely useful circuit-breaker during pain spikes and
// slouch spirals. The circle animates with CSS transforms; under
// prefers-reduced-motion it stays still and the text carries the rhythm.
// Sessions log to breathLog (duration only — nothing else).

import * as store from '../core/store.js';
import { todayKey } from '../core/dates.js';
import { el, mount, openDialog } from '../core/ui.js';

const KEY = 'breathLog';
const PHASES = [
  { id: 'in', label: 'Breathe in', secs: 4 },
  { id: 'hold1', label: 'Hold', secs: 4 },
  { id: 'out', label: 'Breathe out', secs: 4 },
  { id: 'hold2', label: 'Hold', secs: 4 },
];

function logSession(durationSec) {
  if (durationSec < 15) return; // a couple of breaths isn't a session
  const day = todayKey();
  store.update(KEY, (all) => {
    const list = ((all || {})[day] || []).slice();
    list.push({ t: new Date().toISOString(), durationSec: Math.round(durationSec), kind: 'box' });
    return { ...(all || {}), [day]: list };
  });
}

/**
 * Open the breathing overlay.
 * @param {{ minutes?: number }} [opts]
 */
export function openBreathing(opts = {}) {
  const totalSec = Math.round((opts.minutes || 2) * 60);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const circle = el('div', { class: 'breath__circle' + (reduced ? ' breath__circle--still' : '') });
  const phaseLbl = el('div', { class: 'breath__phase' }, 'Ready…');
  const countLbl = el('div', { class: 'breath__count' }, '');
  const remainLbl = el('div', { class: 'breath__remain' }, '');

  let phaseIdx = -1;
  let phaseLeft = 0;
  let elapsed = 0;
  let timer = null;
  let startedAt = null;

  function enterPhase(i) {
    phaseIdx = i;
    const p = PHASES[i];
    phaseLeft = p.secs;
    phaseLbl.textContent = p.label;
    circle.classList.toggle('breath__circle--in', p.id === 'in' || p.id === 'hold1');
    paint();
  }
  function paint() {
    countLbl.textContent = String(phaseLeft);
    const remain = Math.max(0, totalSec - elapsed);
    remainLbl.textContent = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')} left`;
  }
  function tick() {
    elapsed += 1;
    phaseLeft -= 1;
    if (elapsed >= totalSec) { finish('Session complete. Nicely done.'); return; }
    if (phaseLeft <= 0) enterPhase((phaseIdx + 1) % PHASES.length);
    else paint();
  }
  function finish(message) {
    if (timer) { clearInterval(timer); timer = null; }
    if (startedAt != null) logSession(elapsed);
    startedAt = null;
    phaseLbl.textContent = message || 'Stopped.';
    countLbl.textContent = '';
    circle.classList.remove('breath__circle--in');
    startBtn.textContent = 'Start again';
    startBtn.disabled = false;
  }

  const startBtn = el('button', { class: 'btn btn--primary', onClick: () => {
    if (timer) return;
    elapsed = 0;
    startedAt = Date.now();
    startBtn.disabled = true;
    enterPhase(0);
    timer = setInterval(tick, 1000);
  } }, 'Start');

  const handle = openDialog({
    title: 'Box breathing',
    className: 'breath-dialog',
    content: el('div', { class: 'breath' },
      circle,
      phaseLbl,
      countLbl,
      remainLbl,
      el('p', { class: 'field__hint', style: { textAlign: 'center' } },
        'In for 4 · hold 4 · out 4 · hold 4. Let your shoulders drop on every out-breath.')),
    actions: [
      el('button', { class: 'btn btn--ghost', onClick: () => handle.close() }, 'Close'),
      startBtn,
    ],
    onClose: () => { if (timer) { clearInterval(timer); timer = null; logSession(elapsed); } },
  });
}

/** Small launcher row used by wellbeing/flare views. */
export function breathingLauncher() {
  return el('div', { class: 'row' },
    ...[1, 2, 5].map((min) => el('button', {
      class: 'btn btn--sm',
      onClick: () => openBreathing({ minutes: min }),
    }, `${min} min`)));
}
