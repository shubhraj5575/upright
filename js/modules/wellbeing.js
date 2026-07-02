// wellbeing.js — the recovery-around-the-edges view. Phase 6 ships the sleep
// log (hours, quality, position, woke-stiff) with a 14-day chart and the top
// sleep insight; meds, breathing and weight cards join in Phase 7.
// Module contract: init(mountEl) → teardown, getSummary().

import * as store from '../core/store.js';
import { todayKey, addDays, parseKey } from '../core/dates.js';
import { el, mount, clear, card, toast, pageHeader, segmented, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { barChart } from '../core/charts.js';
import { buildInsights } from '../core/insights.js';

const KEY = 'sleepLog';

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

export function init(mountEl) {
  const host = el('div', { class: 'stack' });
  mount(mountEl,
    pageHeader({ title: 'Wellbeing', sub: 'Sleep and the other quiet levers of recovery.' }),
    host
  );
  function render() {
    clear(host);
    mount(host, sleepCard(), historyCard());
  }
  render();
  const unsub = store.subscribe(KEY, render);
  return unsub;
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
