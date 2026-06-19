// pain-trends.js — daily pain & stiffness logging plus trend charts.
// Module contract: exports init(mountEl) and getSummary().

import * as store from '../core/store.js';
import { todayKey, addDays, parseKey } from '../core/dates.js';
import { el, mount, clear, card, slider, toast } from '../core/ui.js';
import { lineChart } from '../core/charts.js';

const KEY = 'painLog';
const RANGES = [
  { id: '1w', label: '1 week', days: 7 },
  { id: '4w', label: '4 weeks', days: 28 },
  { id: '12w', label: '12 weeks', days: 84 },
];
const MIN_ENTRIES_FOR_CHART = 2;

const PAIN_COLOR = 'var(--color-danger)';
const STIFF_COLOR = 'var(--color-accent)';
const AVG_COLOR = 'var(--color-primary)';

function entries() {
  return store.get(KEY) || {};
}

/** Number of days that have a pain value recorded. */
function loggedCount(log) {
  return Object.values(log).filter((e) => e && typeof e.pain === 'number').length;
}

/** Short axis label like "Jun 16" for a day key. */
function shortLabel(key) {
  return parseKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Build per-day values + sparse labels for a range; null where unlogged. */
function buildRange(log, days) {
  const today = todayKey();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(addDays(today, -i));
  const pain = keys.map((k) => (log[k] && typeof log[k].pain === 'number' ? log[k].pain : null));
  const stiff = keys.map((k) => (log[k] && typeof log[k].stiffness === 'number' ? log[k].stiffness : null));

  // 7-day trailing rolling average of pain (over available points in window).
  const avg = pain.map((_, i) => {
    const lo = Math.max(0, i - 6);
    const window = pain.slice(lo, i + 1).filter((v) => v != null);
    if (!window.length) return null;
    return window.reduce((a, b) => a + b, 0) / window.length;
  });

  // Label ~6 evenly-spaced ticks.
  const step = Math.max(1, Math.ceil(days / 6));
  const labels = keys.map((k, i) => (i % step === 0 || i === days - 1 ? shortLabel(k) : ''));

  return { pain, stiff, avg, labels };
}

export function init(mountEl) {
  let range = RANGES[0];

  // --- logging form -------------------------------------------------------
  const today = todayKey();
  const existing = (entries()[today]) || {};

  const painS = slider({ id: 'pain', label: 'Pain', min: 0, max: 10, value: existing.pain ?? 0 });
  const stiffS = slider({ id: 'stiff', label: 'Stiffness', min: 0, max: 10, value: existing.stiffness ?? 0 });
  const moodS = slider({
    id: 'mood', label: 'Mood (optional)', min: 1, max: 5, value: existing.mood ?? 3,
    format: (v) => ['—', '😞', '😕', '😐', '🙂', '😄'][v] || v,
  });
  const notes = el('textarea', { class: 'textarea', id: 'notes', placeholder: 'Anything notable today? (optional)' });
  notes.value = existing.notes || '';

  const saveBtn = el('button', { class: 'btn btn--primary', onClick: onSave }, 'Save today’s entry');
  const savedHint = el('span', { class: 'field__hint' }, existing.pain != null ? 'Saved earlier today — editing updates it.' : '');

  function onSave() {
    store.update(KEY, (log) => ({
      ...log,
      [today]: {
        pain: painS.get(),
        stiffness: stiffS.get(),
        mood: moodS.get(),
        notes: notes.value.trim(),
      },
    }));
    toast('Pain entry saved.', { type: 'success' });
    savedHint.textContent = 'Saved — this updates today’s entry.';
  }

  const formCard = card('How is your back today?',
    el('p', { class: 'card__subtitle' }, 'Rate where you are right now. One quick entry a day builds the trend.'),
    painS.field,
    stiffS.field,
    moodS.field,
    el('div', { class: 'field' }, el('label', { for: 'notes' }, 'Notes'), notes),
    el('div', { class: 'row' }, saveBtn, savedHint)
  );

  // --- trends -------------------------------------------------------------
  const chartHost = el('div', {});
  const rangeBtns = RANGES.map((r) =>
    el('button', {
      class: 'btn btn--sm' + (r.id === range.id ? ' btn--primary' : ''),
      dataset: { range: r.id },
      onClick: () => { range = r; renderChart(); syncRangeBtns(); },
    }, r.label)
  );
  function syncRangeBtns() {
    rangeBtns.forEach((b) => b.classList.toggle('btn--primary', b.dataset.range === range.id));
  }

  function renderChart() {
    const log = entries();
    clear(chartHost);
    if (loggedCount(log) < MIN_ENTRIES_FOR_CHART) {
      mount(chartHost, el('div', { class: 'empty' },
        el('div', { class: 'empty__icon', 'aria-hidden': 'true' }, '📈'),
        el('div', { class: 'empty__title' }, 'Your trend will appear here'),
        el('p', {}, `Log at least ${MIN_ENTRIES_FOR_CHART} days to see your pain and stiffness over time.`)
      ));
      return;
    }
    const { pain, stiff, avg, labels } = buildRange(log, range.days);
    const chart = lineChart({
      series: [
        { values: pain, color: PAIN_COLOR, label: 'Pain', fill: true },
        { values: stiff, color: STIFF_COLOR, label: 'Stiffness' },
        { values: avg, color: AVG_COLOR, label: '7-day avg pain', dashed: true },
      ],
      labels, yMin: 0, yMax: 10, yTicks: 5, height: 240,
      ariaLabel: `Pain and stiffness over the last ${range.label}`,
    });
    const legend = el('div', { class: 'chart-legend' },
      legendItem(PAIN_COLOR, 'Pain'),
      legendItem(STIFF_COLOR, 'Stiffness'),
      legendItem(AVG_COLOR, '7-day avg pain', true)
    );
    mount(chartHost, chart, legend);
  }

  const trendsCard = card('Trends',
    el('div', { class: 'row row--between', style: { marginBottom: 'var(--space-3)' } },
      el('span', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } }, 'Lower is better'),
      el('div', { class: 'chart-ranges' }, ...rangeBtns)
    ),
    chartHost
  );

  mount(mountEl,
    el('div', { class: 'view-header' }, el('h1', {}, 'Pain & symptoms'), el('p', {}, 'Track how your back feels day to day.')),
    formCard,
    trendsCard
  );
  renderChart();

  // Live-update the chart when painLog changes (e.g. import, or another tab).
  const unsub = store.subscribe(KEY, () => renderChart());
  return unsub; // router calls this on navigate-away
}

function legendItem(color, label, dashed) {
  return el('span', {},
    el('span', { class: 'swatch', style: { background: color, height: dashed ? '0' : '3px', borderTop: dashed ? `2px dashed ${color}` : null } }),
    label
  );
}

export function getSummary() {
  const today = todayKey();
  const e = (entries()[today]) || null;
  return {
    logged: !!(e && typeof e.pain === 'number'),
    pain: e ? e.pain : null,
    stiffness: e ? e.stiffness : null,
  };
}
