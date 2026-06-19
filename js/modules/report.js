// report.js — a clean, printable one-page summary to bring to a physio visit.
// Reuses existing logged data (no new storage). The @media print rules in
// app.css strip the app chrome so window.print() yields a tidy sheet.

import * as store from '../core/store.js';
import { todayKey, addDays, parseKey } from '../core/dates.js';
import { el, mount, card } from '../core/ui.js';
import { lineChart } from '../core/charts.js';

function lastKeys(days) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(addDays(todayKey(), -i));
  return keys;
}
function avg(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
function fmt(n, d = 1) {
  return n == null ? '—' : (Math.round(n * 10 ** d) / 10 ** d).toString();
}

function painSection() {
  const log = store.get('painLog') || {};
  const keys = lastKeys(28);
  const pains = [], stiffs = [];
  let logged = 0;
  for (const k of keys) {
    const e = log[k];
    if (e && typeof e.pain === 'number') { pains.push(e.pain); logged++; }
    if (e && typeof e.stiffness === 'number') stiffs.push(e.stiffness);
  }
  const body = el('div', {});
  mount(body,
    el('div', { class: 'row', style: { gap: 'var(--space-6)', flexWrap: 'wrap' } },
      stat('Avg pain (28d)', `${fmt(avg(pains))} / 10`),
      stat('Avg stiffness (28d)', `${fmt(avg(stiffs))} / 10`),
      stat('Days logged', `${logged} / 28`),
      stat('Pain range', pains.length ? `${Math.min(...pains)}–${Math.max(...pains)}` : '—')
    )
  );
  if (pains.length >= 2) {
    const vals = keys.map((k) => (log[k] && typeof log[k].pain === 'number' ? log[k].pain : null));
    const stf = keys.map((k) => (log[k] && typeof log[k].stiffness === 'number' ? log[k].stiffness : null));
    const step = Math.ceil(28 / 6);
    const labels = keys.map((k, i) => (i % step === 0 || i === 27 ? parseKey(k).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''));
    mount(body, el('div', { style: { marginTop: 'var(--space-3)' } },
      lineChart({
        series: [
          { values: vals, color: 'var(--color-danger)', label: 'Pain', fill: true },
          { values: stf, color: 'var(--color-accent)', label: 'Stiffness' },
        ],
        labels, yMin: 0, yMax: 10, yTicks: 5, height: 200, ariaLabel: 'Pain and stiffness, last 28 days',
      })));
  } else {
    mount(body, el('p', { class: 'text-muted' }, 'Not enough pain entries yet to chart a trend.'));
  }
  return card('Pain & stiffness (last 4 weeks)', body);
}

function exerciseSection() {
  const log = store.get('exerciseLog') || {};
  const library = store.get('exercises') || [];
  const nameById = Object.fromEntries(library.map((e) => [e.id, e.name]));
  const tally = (days) => {
    const keys = lastKeys(days);
    let activeDays = 0, sessions = 0;
    const perEx = {};
    for (const k of keys) {
      const ids = log[k] || [];
      if (ids.length) activeDays++;
      sessions += ids.length;
      for (const id of ids) perEx[id] = (perEx[id] || 0) + 1;
    }
    return { activeDays, sessions, perEx };
  };
  const w = tally(7), m = tally(30);
  const rows = Object.entries(m.perEx).sort((a, b) => b[1] - a[1])
    .map(([id, n]) => el('li', {}, `${nameById[id] || id}: ${n}× in 30 days`));

  return card('Exercise adherence',
    el('div', { class: 'row', style: { gap: 'var(--space-6)', flexWrap: 'wrap' } },
      stat('Days active (7d)', `${w.activeDays} / 7`),
      stat('Days active (30d)', `${m.activeDays} / 30`),
      stat('Sessions (30d)', String(m.sessions))
    ),
    rows.length ? el('ul', { style: { marginTop: 'var(--space-3)' } }, ...rows)
      : el('p', { class: 'text-muted', style: { marginTop: 'var(--space-2)' } }, 'No exercises marked done yet.')
  );
}

function goalsSection() {
  const log = store.get('goalsLog') || {};
  const cfg = (store.get('settings') || {}).goals || { waterMl: 2000, steps: 6000 };
  const keys = lastKeys(7);
  const waters = [], steps = [];
  let waterMet = 0, stepMet = 0;
  for (const k of keys) {
    const e = log[k] || {};
    waters.push(e.waterMl || 0); steps.push(e.steps || 0);
    if ((e.waterMl || 0) >= cfg.waterMl) waterMet++;
    if ((e.steps || 0) >= cfg.steps) stepMet++;
  }
  return card('Movement & hydration (last 7 days)',
    el('div', { class: 'row', style: { gap: 'var(--space-6)', flexWrap: 'wrap' } },
      stat('Avg steps', Math.round(avg(steps) || 0).toLocaleString()),
      stat('Step goal met', `${stepMet} / 7 days`),
      stat('Avg water', `${fmt((avg(waters) || 0) / 1000)} L`),
      stat('Water goal met', `${waterMet} / 7 days`)
    )
  );
}

function stat(label, value) {
  return el('div', {},
    el('div', { style: { fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)' } }, value),
    el('div', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } }, label));
}

export function init(mountEl) {
  const constraints = (store.get('settings') || {}).physioConstraints || '';
  const today = parseKey(todayKey()).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  mount(mountEl,
    el('div', { class: 'view-header' },
      el('h1', {}, 'Physio visit report'),
      el('p', {}, `Prepared ${today} from your Upright logs.`)),
    el('div', { class: 'row no-print', style: { marginBottom: 'var(--space-4)' } },
      el('button', { class: 'btn btn--primary', onClick: () => window.print() }, '🖨 Print / Save as PDF'),
      el('span', { class: 'text-faint', style: { fontSize: 'var(--text-sm)' } }, 'Tip: choose “Save as PDF” in the print dialog.')),
    card('Your physiotherapist’s instructions',
      constraints
        ? el('p', { style: { whiteSpace: 'pre-wrap' } }, constraints)
        : el('p', { class: 'text-muted' }, 'No constraints recorded yet — add them in Settings so they appear here.')),
    painSection(),
    exerciseSection(),
    goalsSection(),
    el('p', { class: 'text-faint', style: { fontSize: 'var(--text-xs)', marginTop: 'var(--space-4)' } },
      'Upright is a self-tracking wellness tool, not a medical record or medical advice. '
      + 'Figures are self-reported.')
  );

  // Subscribe so the report stays fresh if data changes while open.
  return store.subscribe('*', () => { /* no-op: report is a snapshot; reopen to refresh */ });
}
