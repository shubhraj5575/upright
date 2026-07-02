// exercises.js — rehab exercise library with per-exercise interval timers
// (hold/rest countdowns with a WebAudio cue), a daily “done” log, a completed-
// sets tally, and custom-exercise CRUD. Generic examples only — the view leads
// with a callout to follow the user’s own physiotherapist. Module contract:
// exports init(mountEl) → teardown, and getSummary().

import * as store from '../core/store.js';
import { todayKey } from '../core/dates.js';
import { el, mount, clear, card, toast, pageHeader, skeletonGrid, confirmDialog, openDialog, emptyState, setFieldError } from '../core/ui.js';
import { icon } from '../core/icons.js';

const KEY = 'exercises';
const LOG_KEY = 'exerciseLog';
const SEED_URL = 'data/exercises-starter.json';

function library() {
  return store.get(KEY) || [];
}
function doneToday() {
  const log = store.get(LOG_KEY) || {};
  return log[todayKey()] || [];
}
function isDone(id) {
  return doneToday().includes(id);
}

/** Mark/unmark an exercise as done today (deduped). */
function toggleDone(id) {
  const k = todayKey();
  store.update(LOG_KEY, (log) => {
    const day = (log[k] || []).slice();
    const i = day.indexOf(id);
    if (i === -1) day.push(id); else day.splice(i, 1);
    return { ...log, [k]: day };
  });
}

function slug(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'exercise';
}

function isCustom(ex) {
  return typeof ex.id === 'string' && ex.id.startsWith('custom-');
}

async function loadSeed() {
  const res = await fetch(SEED_URL);
  if (!res.ok) throw new Error(`seed fetch failed: ${res.status}`);
  return res.json();
}

export function init(mountEl) {
  let torn = false;
  const intervals = new Set(); // every setInterval id lands here for teardown
  let unsubs = [];
  let audioCtx = null;
  const sets = {}; // id -> completed-set tally, in-memory for this view only

  const header = pageHeader({
    title: 'Rehab exercises',
    sub: 'Gentle lower-back movements with built-in timers. Move within a comfortable, pain-free range.',
  });
  const disclaimer = el('div', { class: 'callout callout--warn', style: { marginBottom: 'var(--space-4)' } },
    el('div', { class: 'callout__title' }, '⚠ Generic examples only'),
    el('p', {}, 'These are common rehab exercises, not a prescription. Always follow the specific exercises, sets and limits your physiotherapist gave you — and stop anything that increases your pain.'));
  const host = el('div', { class: 'stack' });

  mount(mountEl, header, disclaimer, host);
  mount(host, skeletonGrid(4));

  // --- audio ---------------------------------------------------------------
  // Lazily create one shared AudioContext on the first user gesture (Start),
  // satisfying the browser autoplay policy. A single ~120ms oscillator beep
  // marks each phase transition.
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
    return audioCtx;
  }
  function beep(freq = 660) {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.12;
    osc.connect(gain).connect(ctx.destination);
    const t = ctx.currentTime;
    osc.start(t);
    osc.stop(t + 0.12);
  }

  // --- timer per exercise --------------------------------------------------
  // For hold-based exercises (holdSec > 0) each set is a hold phase then a rest
  // phase; for rep-based exercises each set is just a rest phase between sets.
  // One setInterval per running exercise, tracked in `intervals` and cleared on
  // teardown and on every re-render.
  function makeTimer(ex) {
    const total = Math.max(1, ex.defaultSets || 1);
    const hold = ex.holdSec || 0;
    const rest = ex.restSec || 0;

    const big = el('div', { class: 'timer__count' });
    const phaseLbl = el('div', { class: 'timer__phase' });
    // One dot per set — fills as sets complete, so progress reads at a glance.
    const dots = Array.from({ length: total }, () => el('span', { class: 'timer__dot' }));
    const dotsRow = el('div', { class: 'timer__dots', 'aria-hidden': 'true' }, ...dots);

    let intId = null;
    let phase = 'idle'; // 'idle' | 'hold' | 'rest' | 'done'
    let setNo = 1;
    let remaining = 0;

    function paint() {
      if (phase === 'idle') { big.textContent = '—'; phaseLbl.textContent = 'Ready'; }
      else if (phase === 'done') { big.textContent = '✓'; phaseLbl.textContent = 'All sets complete'; }
      else { big.textContent = `${remaining}s`; phaseLbl.textContent = `${phase === 'hold' ? 'Hold' : 'Rest'} — set ${setNo} of ${total}`; }
      big.classList.toggle('timer__count--hold', phase === 'hold');
      big.classList.toggle('timer__count--done', phase === 'done');
      dots.forEach((d, i) => {
        d.classList.toggle('timer__dot--done', phase === 'done' || i < setNo - 1);
        d.classList.toggle('timer__dot--active', phase !== 'idle' && phase !== 'done' && i === setNo - 1);
      });
      startBtn.textContent = intId ? 'Pause' : (phase === 'idle' || phase === 'done' ? 'Start' : 'Resume');
    }

    function clearInt() {
      if (intId != null) { clearInterval(intId); intervals.delete(intId); intId = null; }
    }

    function enterPhase(p) {
      phase = p;
      remaining = p === 'hold' ? hold : rest;
      beep(p === 'hold' ? 720 : 520);
      paint();
    }

    function advance() {
      // Called when the current phase's countdown reaches 0.
      if (phase === 'hold') {
        if (rest > 0) { enterPhase('rest'); return; }
        phase = 'rest'; remaining = 0; // no rest configured → fall through to next set
      }
      // finishing a rest (or a zero-rest hold) ends the current set
      if (setNo >= total) { clearInt(); phase = 'done'; beep(880); paint(); return; }
      setNo += 1;
      enterPhase(hold > 0 ? 'hold' : 'rest');
    }

    function tick() {
      remaining -= 1;
      if (remaining <= 0) { advance(); return; }
      paint();
    }

    function play() {
      if (intId) return; // already running — guard double-Start
      ensureAudio(); // first gesture: unlock audio even if first beep is the start cue
      if (phase === 'idle' || phase === 'done') { setNo = 1; enterPhase(hold > 0 ? 'hold' : 'rest'); }
      intId = setInterval(tick, 1000);
      intervals.add(intId);
      paint();
    }
    function pause() { clearInt(); paint(); }
    function reset() { clearInt(); phase = 'idle'; setNo = 1; remaining = 0; paint(); }

    const startBtn = el('button', { class: 'btn btn--primary btn--sm', onClick: () => (intId ? pause() : play()) }, 'Start');
    const resetBtn = el('button', { class: 'btn btn--ghost btn--sm', onClick: reset }, 'Reset');

    paint();

    return el('div', { class: 'timer' },
      big,
      phaseLbl,
      dotsRow,
      el('div', { class: 'row', style: { justifyContent: 'center', marginTop: 'var(--space-2)' } }, startBtn, resetBtn));
  }

  // --- one exercise card ---------------------------------------------------
  // Each card lives in a wrapper so Edit can swap the editor in place (and
  // Cancel/Save swaps it back), mirroring the inline reset-confirm pattern.
  function exerciseSlot(ex) {
    const wrap = el('div', {});
    wrap.appendChild(exerciseCard(ex, wrap));
    return wrap;
  }

  function exerciseCard(ex, wrap) {
    const done = isDone(ex.id);
    const repInfo = (ex.holdSec || 0) > 0
      ? `${ex.defaultSets || 1} × hold ${ex.holdSec}s`
      : `${ex.defaultSets || 1} × ${ex.defaultReps || 0} reps`;

    // collapsible instructions — native <details> gets keyboard/SR for free
    const instructions = (ex.instructions || []).length
      ? el('details', { class: 'ex-instructions' },
          el('summary', {}, 'Instructions'),
          el('ul', { style: { margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-5)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' } },
            ...(ex.instructions || []).map((s) => el('li', { style: { marginBottom: 'var(--space-1)' } }, s))))
      : null;

    // sets tally
    const tallyN = el('span', { class: 'badge badge--primary' }, `${sets[ex.id] || 0} sets done`);
    const tallyBtn = el('button', { class: 'btn btn--sm', onClick: () => {
      sets[ex.id] = (sets[ex.id] || 0) + 1;
      tallyN.textContent = `${sets[ex.id]} sets done`;
    } }, '+ set');
    const tallyReset = el('button', { class: 'btn btn--ghost btn--sm', onClick: () => {
      sets[ex.id] = 0;
      tallyN.textContent = '0 sets done';
    } }, 'Clear');

    const doneBtn = el('button', { class: 'btn btn--sm' + (done ? '' : ' btn--primary'),
      onClick: () => toggleDone(ex.id) }, done ? [icon('check', { size: 14 }), ' Done today'] : 'Mark done today');

    const actions = el('div', { class: 'row', style: { flexWrap: 'wrap', marginTop: 'var(--space-3)' } }, doneBtn, tallyBtn, tallyN, tallyReset);

    if (isCustom(ex)) {
      actions.appendChild(el('button', { class: 'btn btn--ghost btn--sm',
        onClick: () => openEditorDialog(ex) }, icon('edit', { size: 14 }), ' Edit'));
      actions.appendChild(el('button', { class: 'btn btn--danger btn--sm', onClick: async () => {
        const yes = await confirmDialog({
          title: `Delete “${ex.name}”?`,
          body: 'This removes the exercise from your library. Days you already marked it done stay in your history.',
          confirmLabel: 'Delete', danger: true,
        });
        if (yes) deleteCustom(ex.id);
      } }, icon('trash', { size: 14 }), ' Delete'));
    }

    return card(null,
      el('div', { class: 'row row--between' },
        el('h2', { class: 'card__title', style: { marginBottom: 0 } }, ex.name),
        el('span', { class: 'badge badge--accent' }, ex.category || 'Exercise')),
      el('div', { class: 'row', style: { gap: 'var(--space-4)', alignItems: 'center', marginTop: 'var(--space-3)' } },
        el('div', { html: ex.demoSvg || '', style: { color: 'var(--color-primary)', flex: '0 0 auto' } }),
        el('div', {},
          el('p', { style: { fontStyle: 'italic', color: 'var(--color-text-muted)', margin: 0 } }, ex.cue || ''),
          el('p', { style: { fontWeight: 'var(--weight-medium)', marginTop: 'var(--space-2)' } }, repInfo))),
      makeTimer(ex),
      instructions,
      actions);
  }

  // --- custom add / edit (in a dialog) --------------------------------------
  function openEditorDialog(existing) {
    const name = el('input', { class: 'input', placeholder: 'Exercise name' });
    const cat = el('input', { class: 'input', placeholder: 'Category, e.g. Mobility' });
    const setsIn = el('input', { class: 'input', type: 'number', min: '1', step: '1', value: '2' });
    const repsIn = el('input', { class: 'input', type: 'number', min: '0', step: '1', value: '10' });
    const holdIn = el('input', { class: 'input', type: 'number', min: '0', step: '1', value: '0' });
    const instr = el('textarea', { class: 'textarea', placeholder: 'One instruction per line.' });
    if (existing) {
      name.value = existing.name || '';
      cat.value = existing.category || '';
      setsIn.value = String(existing.defaultSets || 1);
      repsIn.value = String(existing.defaultReps || 0);
      holdIn.value = String(existing.holdSec || 0);
      instr.value = (existing.instructions || []).join('\n');
    }

    const nameField = el('div', { class: 'field', style: { marginBottom: 0 } }, el('label', {}, 'Name'), name);
    function field(label, node) {
      return el('div', { class: 'field', style: { marginBottom: 0 } }, el('label', {}, label), node);
    }

    function onSave() {
      const nm = name.value.trim();
      if (!nm) { setFieldError(nameField, 'Give the exercise a name.'); return false; }
      setFieldError(nameField, null);
      const obj = {
        id: existing ? existing.id : `custom-${slug(nm)}-${Date.now()}`,
        name: nm,
        category: cat.value.trim() || 'Custom',
        instructions: instr.value.split('\n').map((s) => s.trim()).filter(Boolean),
        cue: existing ? (existing.cue || '') : '',
        defaultSets: Math.max(1, Number(setsIn.value) || 1),
        defaultReps: Math.max(0, Number(repsIn.value) || 0),
        holdSec: Math.max(0, Number(holdIn.value) || 0),
        restSec: existing ? (existing.restSec || 30) : 30,
        demoSvg: existing ? (existing.demoSvg || '') : '',
      };
      store.update(KEY, (list) => {
        const arr = (list || []).slice();
        if (existing) {
          const i = arr.findIndex((e) => e.id === existing.id);
          if (i !== -1) arr[i] = obj;
        } else {
          arr.push(obj);
        }
        return arr;
      });
      toast(existing ? 'Exercise updated.' : 'Exercise added.', { type: 'success' });
      return true;
    }

    const saveBtn = el('button', { class: 'btn btn--primary', onClick: () => { if (onSave()) handle.close(); } },
      existing ? 'Save changes' : 'Add exercise');
    const cancelBtn = el('button', { class: 'btn btn--ghost', onClick: () => handle.close() }, 'Cancel');
    const handle = openDialog({
      title: existing ? `Edit ${existing.name}` : 'Add your own exercise',
      content: el('div', {},
        el('div', { class: 'grid' },
          nameField, field('Category', cat),
          field('Sets', setsIn), field('Reps (0 if hold-based)', repsIn),
          field('Hold seconds (0 if rep-based)', holdIn)),
        el('div', { class: 'field', style: { marginTop: 'var(--space-4)', marginBottom: 0 } }, el('label', {}, 'Instructions'), instr)),
      actions: [cancelBtn, saveBtn],
    });
    name.focus();
  }

  function deleteCustom(id) {
    store.update(KEY, (list) => (list || []).filter((e) => e.id !== id));
    toast('Exercise removed.', { type: 'info' });
  }

  // --- library management ----------------------------------------------------
  function libraryCard() {
    return card('Your library',
      el('p', { class: 'card__subtitle' }, 'Add the exact exercises your physio prescribed, or reset to the starter set.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn--primary', onClick: () => openEditorDialog(null) }, icon('plus', { size: 16 }), 'Add your own exercise'),
        el('button', { class: 'btn btn--ghost', onClick: async () => {
          const yes = await confirmDialog({
            title: 'Reset library to starter?',
            body: 'This replaces the whole library with the starter exercises and removes any custom ones you added.',
            confirmLabel: 'Reset library', danger: true,
          });
          if (!yes) return;
          try {
            const seed = await loadSeed();
            if (torn) return;
            store.set(KEY, seed);
            toast('Library reset to starter exercises.', { type: 'info' });
          } catch (_) {
            toast('Could not load the starter exercises.', { type: 'error' });
          }
        } }, 'Reset to starter…')));
  }

  // --- render --------------------------------------------------------------
  function render() {
    // Clear any running countdown intervals before rebuilding (subscriptions
    // trigger a full re-render; otherwise old timers would tick on dead DOM).
    intervals.forEach(clearInterval);
    intervals.clear();
    clear(host);

    const list = library();
    if (!list.length) {
      mount(host, emptyState({
        icon: 'dumbbell',
        title: 'No exercises yet',
        body: 'Add the movements your physio gave you, or reset to the starter set below.',
      }));
    }
    mount(host, ...list.map((ex) => exerciseSlot(ex)));
    mount(host, libraryCard());
  }

  // --- async seed-then-build ----------------------------------------------
  (async () => {
    let list = store.get(KEY);
    if (Array.isArray(list) && list.length === 0) {
      try {
        const seed = await loadSeed();
        store.set(KEY, seed);
      } catch (_) {
        if (torn) return;
        clear(host);
        mount(host, emptyState({
          icon: 'alert-triangle',
          title: 'Couldn’t load exercises',
          body: 'The starter exercises failed to load. Check your connection and reopen this page.',
        }));
        return;
      }
    }
    if (torn) return; // navigated away mid-fetch → don’t build/subscribe a dead view
    render();
    unsubs.push(store.subscribe(KEY, render));
    unsubs.push(store.subscribe(LOG_KEY, render));
  })();

  return () => {
    torn = true;
    intervals.forEach(clearInterval);
    intervals.clear();
    unsubs.forEach((u) => u());
    unsubs = [];
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
  };
}

export function getSummary() {
  return {
    doneToday: doneToday().length,
    total: library().length,
  };
}
