// wellbeing.js — the recovery-around-the-edges view. Phase 6 ships the sleep
// log (hours, quality, position, woke-stiff) with a 14-day chart and the top
// sleep insight; meds, breathing and weight cards join in Phase 7.
// Module contract: init(mountEl) → teardown, getSummary().

import * as store from '../core/store.js';
import { todayKey, addDays, parseKey } from '../core/dates.js';
import { el, mount, clear, card, toast, pageHeader, segmented, emptyState, setFieldError } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { barChart, lineChart } from '../core/charts.js';
import { buildInsights } from '../core/insights.js';
import { breathingLauncher } from './breathing.js';

const KEY = 'sleepLog';
const MED_KEY = 'medLog';
const WEIGHT_KEY = 'weightLog';
const KG_PER_LB = 0.45359237;

const POSITIONS = [
  { value: 'back', label: 'Back' },
  { value: 'side', label: 'Side' },
  { value: 'stomach', label: 'Stomach' },
  { value: 'mixed', label: 'Mixed' },
];

function log() {
  return store.get(KEY) || {};
}

function lastLoggedHours() {
  const entries = Object.entries(log()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  return entries.length ? entries[0][1].hours : 7;
}

function sleepCard() {
  const today = todayKey();
  const existing = log()[today] || null;

  let hours = existing ? existing.hours : lastLoggedHours();
  const hoursOut = el('span', { class: 'sleep-hours__value' });
  function paintHours() { hoursOut.textContent = `${hours}h`; }
  paintHours();
  const stepBtn = (delta, label) => el('button', {
    class: 'btn btn--sm', 'aria-label': label,
    onClick: () => { hours = Math.max(0, Math.min(14, Math.round((hours + delta) * 2) / 2)); paintHours(); },
  }, delta > 0 ? '+30m' : '−30m');
  const hoursRow = el('div', { class: 'sleep-hours' }, stepBtn(-0.5, 'Half an hour less'), hoursOut, stepBtn(0.5, 'Half an hour more'));

  let quality = existing ? existing.quality : 3;
  const qualitySeg = segmented({
    ariaLabel: 'Sleep quality',
    value: String(quality),
    options: [1, 2, 3, 4, 5].map((q) => ({ value: String(q), label: ['', 'Rough', 'Poor', 'Okay', 'Good', 'Great'][q] })),
    onChange: (v) => { quality = Number(v); },
  });

  let position = existing ? existing.position : null;
  const posSeg = segmented({
    ariaLabel: 'Sleep position',
    value: position || undefined,
    options: POSITIONS,
    onChange: (v) => { position = v; },
  });

  const stiffBox = el('input', { type: 'checkbox', checked: existing ? !!existing.wokeStiff : false });

  const savedHint = el('span', { class: 'field__hint' }, existing ? 'Logged for last night — saving updates it.' : '');
  const saveBtn = el('button', { class: 'btn btn--primary', onClick: () => {
    store.update(KEY, (all) => ({
      ...(all || {}),
      [today]: { hours, quality, position, wokeStiff: stiffBox.checked, t: new Date().toISOString() },
    }));
    toast('Sleep logged.', { type: 'success' });
    savedHint.textContent = 'Saved — this updates last night’s entry.';
    saveBtn.replaceChildren(icon('check', { size: 16 }), ' Saved');
    setTimeout(() => saveBtn.replaceChildren('Save last night'), 2000);
  } }, 'Save last night');

  return card('Last night’s sleep',
    el('p', { class: 'card__subtitle' }, 'Backs do their healing overnight — a 10-second log builds the picture.'),
    el('div', { class: 'field' }, el('label', {}, 'Hours slept'), hoursRow),
    el('div', { class: 'field' }, el('label', {}, 'Quality'), qualitySeg.root),
    el('div', { class: 'field' }, el('label', {}, 'Mostly slept on'), posSeg.root),
    el('label', { class: 'row', style: { gap: 'var(--space-2)', marginBottom: 'var(--space-4)' } }, stiffBox, ' I woke up stiff'),
    el('div', { class: 'row' }, saveBtn, savedHint)
  );
}

function historyCard() {
  const today = todayKey();
  const keys = [];
  for (let i = 13; i >= 0; i--) keys.push(addDays(today, -i));
  const values = keys.map((k) => (log()[k] && typeof log()[k].hours === 'number' ? log()[k].hours : 0));
  const labels = keys.map((k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'narrow' }));
  const any = values.some((v) => v > 0);

  const body = any
    ? barChart({ values, labels, goal: 7, color: 'var(--violet-400)', height: 150, ariaLabel: 'Hours slept, last 14 nights', interactive: true, tipFormat: (v) => `${v}h` })
    : emptyState({ icon: 'moon', title: 'No nights logged yet', body: 'Your last 14 nights will chart here, with the 7-hour line to aim for.' });

  // Top sleep insight (or the closest hint to unlocking one).
  const data = {
    painLog: store.get('painLog'), sleepLog: log(), postureSelfLog: store.get('postureSelfLog'),
    goalsLog: store.get('goalsLog'), exerciseLog: store.get('exerciseLog'),
    postureCamLog: store.get('postureCamLog'), activityLog: store.get('activityLog'),
    flareLog: store.get('flareLog'), settings: store.get('settings'),
  };
  const res = buildInsights(data, today);
  const sleepInsight = res.top.find((r) => r.group === 'sleep')
    || res.unlocked.find((r) => r.group === 'sleep')
    || null;
  const sleepLocked = !sleepInsight ? res.locked.find((r) => r.group === 'sleep') : null;

  return card('Sleep, last 14 nights',
    body,
    (sleepInsight || sleepLocked) ? el('div', { class: 'callout', style: { marginTop: 'var(--space-4)' } },
      el('p', {},
        el('strong', {}, sleepInsight ? 'Pattern: ' : 'Locked: '),
        sleepInsight ? sleepInsight.text : sleepLocked.lockedText)) : null
  );
}

// --- meds ---------------------------------------------------------------------

function medLog() {
  return store.get(MED_KEY) || {};
}

/** Unique recent name+dose combos (last 14 days) for one-tap re-logging. */
function recentMedCombos() {
  const seen = new Map();
  for (let i = 0; i < 14; i++) {
    for (const e of medLog()[addDays(todayKey(), -i)] || []) {
      const k = `${e.name}|${e.dose}`;
      if (!seen.has(k)) seen.set(k, { name: e.name, dose: e.dose });
    }
  }
  return [...seen.values()].slice(0, 4);
}

function addMed(name, dose) {
  const day = todayKey();
  store.update(MED_KEY, (all) => {
    const list = ((all || {})[day] || []).slice();
    list.push({ t: new Date().toISOString(), name, dose });
    return { ...(all || {}), [day]: list };
  });
}

function medsCard() {
  const nameIn = el('input', { class: 'input', placeholder: 'e.g. Ibuprofen' });
  const doseIn = el('input', { class: 'input', placeholder: 'e.g. 400 mg', style: { maxWidth: '130px' } });
  const nameField = el('div', { class: 'field', style: { marginBottom: 0, flex: '1' } }, nameIn);

  function submit(name, dose) {
    if (!name) { setFieldError(nameField, 'Name the medication or supplement first.'); return; }
    setFieldError(nameField, null);
    addMed(name, dose);
    nameIn.value = ''; doseIn.value = '';
  }

  const combos = recentMedCombos();
  const today = medLog()[todayKey()] || [];
  const times = ((store.get('settings') || {}).meds || {}).reminderTimes || [];

  return card('Medications & supplements',
    el('p', { class: 'card__subtitle' }, 'A private tally — useful for “how often did I actually need it?” at your next visit.'),
    combos.length ? el('div', { class: 'row', style: { marginBottom: 'var(--space-3)' } },
      ...combos.map((c) => el('button', { class: 'btn btn--sm', onClick: () => submit(c.name, c.dose) },
        icon('plus', { size: 13 }), `${c.name}${c.dose ? ' ' + c.dose : ''}`))) : null,
    el('div', { class: 'row', style: { alignItems: 'flex-start' } },
      nameField, doseIn,
      el('button', { class: 'btn btn--primary', onClick: () => submit(nameIn.value.trim(), doseIn.value.trim()) }, 'Log')),
    today.length ? el('ul', { class: 'posture-list', style: { marginTop: 'var(--space-4)' } },
      ...today.slice().reverse().map((e) => el('li', { class: 'posture-list__item' },
        el('span', { style: { color: 'var(--color-text-muted)', display: 'inline-flex' } }, icon('pill', { size: 16 })),
        el('span', {}, `${e.name}${e.dose ? ' — ' + e.dose : ''}`),
        el('span', { class: 'text-faint', style: { marginLeft: 'auto', fontSize: 'var(--text-xs)' } },
          new Date(e.t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })),
        el('button', {
          class: 'btn btn--ghost btn--sm', 'aria-label': `Remove ${e.name}`,
          onClick: () => store.update(MED_KEY, (all) => ({
            ...(all || {}), [todayKey()]: ((all || {})[todayKey()] || []).filter((x) => x.t !== e.t),
          })),
        }, icon('x', { size: 14 })))))
      : el('p', { class: 'field__hint', style: { marginTop: 'var(--space-3)' } }, 'Nothing logged today.'),
    el('p', { class: 'field__hint', style: { marginTop: 'var(--space-3)' } },
      times.length
        ? `Reminders at ${times.join(', ')} — edit in Settings.`
        : 'Want a daily reminder? Add times in Settings → Wellbeing.')
  );
}

// --- breathing -------------------------------------------------------------------

function breathingCard() {
  const day = (store.get('breathLog') || {})[todayKey()] || [];
  const totalMin = Math.round(day.reduce((s, e) => s + (e.durationSec || 0), 0) / 60);
  return card('Box breathing',
    el('p', { class: 'card__subtitle' }, 'Four counts in, hold, out, hold. A two-minute circuit-breaker for pain spikes and tense shoulders.'),
    breathingLauncher(),
    day.length ? el('p', { class: 'field__hint', style: { marginTop: 'var(--space-3)' } },
      `${day.length} session${day.length === 1 ? '' : 's'} today (${totalMin || '<1'} min).`) : null
  );
}

// --- weight (opt-in) ----------------------------------------------------------------

function weightSettings() {
  return ((store.get('settings') || {}).wellbeing) || {};
}

function weightCard() {
  const cfg = weightSettings();
  if (!cfg.weightEnabled) return null;
  const unit = cfg.weightUnit === 'lb' ? 'lb' : 'kg';
  const toDisplay = (kg) => (unit === 'lb' ? kg / KG_PER_LB : kg);
  const toKg = (v) => (unit === 'lb' ? v * KG_PER_LB : v);

  const existing = (store.get(WEIGHT_KEY) || {})[todayKey()];
  const input = el('input', { class: 'input', type: 'number', step: '0.1', min: '20', max: unit === 'lb' ? '700' : '320', style: { maxWidth: '120px' }, 'aria-label': `Weight in ${unit}` });
  if (existing) input.value = String(Math.round(toDisplay(existing.kg) * 10) / 10);
  const field = el('div', { class: 'field', style: { marginBottom: 0 } }, input);

  // 12-week weekly means.
  const weeks = [];
  const log = store.get(WEIGHT_KEY) || {};
  for (let w = 11; w >= 0; w--) {
    const vals = [];
    for (let d = 0; d < 7; d++) {
      const e = log[addDays(todayKey(), -(w * 7 + d))];
      if (e && typeof e.kg === 'number') vals.push(e.kg);
    }
    weeks.push(vals.length ? Math.round(toDisplay(vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null);
  }
  const real = weeks.filter((v) => v != null);
  const chart = real.length >= 2
    ? lineChart({
        series: [{ values: weeks, color: 'var(--color-info)', label: `Weight (${unit})`, fill: true }],
        labels: weeks.map((_, i) => (i % 2 === 0 ? `${11 - i}w` : '')),
        yMin: Math.floor(Math.min(...real) - 2), yMax: Math.ceil(Math.max(...real) + 2),
        height: 160, yTicks: 4, ariaLabel: 'Weekly average weight, last 12 weeks',
        interactive: true, gradientFill: true,
      })
    : el('p', { class: 'field__hint' }, 'Weekly averages chart here once you have a couple of weeks of entries.');

  return card('Weight (optional)',
    el('p', { class: 'card__subtitle' }, 'Weekly averages only — day-to-day wiggle is water, not truth. No goals, no judgement.'),
    el('div', { class: 'row', style: { alignItems: 'flex-end', marginBottom: 'var(--space-4)' } },
      field,
      el('span', { class: 'text-muted' }, unit),
      el('button', { class: 'btn btn--primary btn--sm', onClick: () => {
        const v = Number(input.value);
        if (!input.value.trim() || Number.isNaN(v) || v <= 0) { setFieldError(field, 'Enter a weight first.'); return; }
        setFieldError(field, null);
        store.update(WEIGHT_KEY, (all) => ({
          ...(all || {}), [todayKey()]: { kg: Math.round(toKg(v) * 10) / 10, t: new Date().toISOString() },
        }));
        toast('Weight logged.', { type: 'success' });
      } }, existing ? 'Update today' : 'Log today')),
    chart
  );
}

export function init(mountEl) {
  const host = el('div', { class: 'stack' });
  mount(mountEl,
    pageHeader({ title: 'Wellbeing', sub: 'Sleep, meds, breathing — the quiet levers of recovery.' }),
    host
  );
  function render() {
    clear(host);
    mount(host, sleepCard(), historyCard(), medsCard(), breathingCard(), weightCard());
  }
  render();
  const unsubs = [KEY, MED_KEY, WEIGHT_KEY, 'breathLog'].map((k) => store.subscribe(k, render));
  return () => unsubs.forEach((u) => u());
}

export function getSummary() {
  const e = log()[todayKey()] || null;
  return {
    loggedToday: !!e,
    hours: e ? e.hours : null,
    quality: e ? e.quality : null,
    wokeStiff: e ? !!e.wokeStiff : null,
  };
}
