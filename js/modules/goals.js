// goals.js — daily walk (steps) & water goals with rings, streaks and a weekly
// bar chart. Module contract: exports init(mountEl) and getSummary().

import * as store from '../core/store.js';
import { todayKey, addDays, parseKey, computeStreak } from '../core/dates.js';
import { el, mount, clear, card, toast } from '../core/ui.js';
import { progressRing, barChart } from '../core/charts.js';

const KEY = 'goalsLog';

function goalsCfg() {
  const s = store.get('settings') || {};
  const g = s.goals || {};
  return { waterMl: g.waterMl || 2000, waterStepMl: g.waterStepMl || 250, steps: g.steps || 6000 };
}

function log() {
  return store.get(KEY) || {};
}

function today() {
  return todayKey();
}

function entryFor(key) {
  const e = log()[key];
  return { waterMl: (e && e.waterMl) || 0, steps: (e && e.steps) || 0 };
}

// Exported so the dashboard's quick-log buttons reuse this exact logic
// (single source of truth) rather than writing to the store independently.
export function addWater(ml) {
  const k = today();
  store.update(KEY, (l) => {
    const cur = l[k] || { waterMl: 0, steps: 0 };
    return { ...l, [k]: { ...cur, waterMl: Math.max(0, (cur.waterMl || 0) + ml) } };
  });
}

export function addSteps(n) {
  const k = today();
  store.update(KEY, (l) => {
    const cur = l[k] || { waterMl: 0, steps: 0 };
    return { ...l, [k]: { ...cur, steps: Math.max(0, (cur.steps || 0) + n) } };
  });
}

/** The configured goals, for the dashboard's quick-log step size. */
export function config() {
  return goalsCfg();
}

/** Day keys (within `days`) where the given goal was met. */
function metKeys(field, goal, days = 120) {
  const l = log();
  const out = [];
  for (let i = 0; i < days; i++) {
    const k = addDays(today(), -i);
    if (l[k] && (l[k][field] || 0) >= goal) out.push(k);
  }
  return out;
}

function lastWeek(field) {
  const l = log();
  const keys = [];
  for (let i = 6; i >= 0; i--) keys.push(addDays(today(), -i));
  return {
    values: keys.map((k) => (l[k] && l[k][field]) || 0),
    labels: keys.map((k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'narrow' })),
  };
}

export function init(mountEl) {
  const host = el('div', { class: 'stack' });
  mount(mountEl,
    el('div', { class: 'view-header' }, el('h1', {}, 'Walk & water'), el('p', {}, 'Small daily goals that support recovery — gentle movement and staying hydrated.')),
    host
  );

  function render() {
    clear(host);
    const cfg = goalsCfg();
    const t = entryFor(today());
    const waterPct = Math.round((t.waterMl / cfg.waterMl) * 100);
    const stepPct = Math.round((t.steps / cfg.steps) * 100);

    const waterStreak = computeStreak(metKeys('waterMl', cfg.waterMl), today());
    const stepStreak = computeStreak(metKeys('steps', cfg.steps), today());

    // --- today rings + quick actions ---
    const waterBlock = el('div', { class: 'ring-block' },
      progressRing({
        value: t.waterMl, max: cfg.waterMl, color: 'var(--color-water)',
        center: `${(t.waterMl / 1000).toFixed(t.waterMl % 1000 ? 1 : 0)}L`,
        sub: `of ${(cfg.waterMl / 1000).toFixed(1)}L`, label: 'Water',
      }),
      el('div', { class: 'ring-block__label' }, '💧 Water'),
      el('div', { class: 'ring-block__actions' },
        el('button', { class: 'btn btn--sm', onClick: () => addWater(cfg.waterStepMl) }, `+${cfg.waterStepMl} ml`),
        el('button', { class: 'btn btn--sm', onClick: () => addWater(500) }, '+500 ml'),
        el('button', { class: 'btn btn--sm btn--ghost', onClick: () => addWater(-cfg.waterStepMl) }, '−')
      )
    );

    const stepInput = el('input', { class: 'input', type: 'number', min: '0', step: '100', placeholder: 'e.g. 1500', style: { maxWidth: '120px' } });
    const stepBlock = el('div', { class: 'ring-block' },
      progressRing({
        value: t.steps, max: cfg.steps, color: 'var(--color-primary)',
        center: t.steps.toLocaleString(), sub: `of ${cfg.steps.toLocaleString()}`, label: 'Steps',
      }),
      el('div', { class: 'ring-block__label' }, '🚶 Steps'),
      el('div', { class: 'ring-block__actions' },
        el('button', { class: 'btn btn--sm', onClick: () => addSteps(1000) }, '+1,000'),
        stepInput,
        el('button', { class: 'btn btn--sm btn--primary', onClick: () => {
          const v = Number(stepInput.value);
          if (v > 0) { addSteps(v); stepInput.value = ''; }
        } }, 'Add')
      )
    );

    const streakRow = el('div', { class: 'row', style: { justifyContent: 'center', marginTop: 'var(--space-4)' } },
      el('span', { class: 'badge badge--accent' }, `💧 ${waterStreak}-day water streak`),
      el('span', { class: 'badge badge--primary' }, `🚶 ${stepStreak}-day step streak`)
    );

    const todayCard = card('Today',
      el('div', { class: 'ring-group' }, waterBlock, stepBlock),
      streakRow,
      (waterPct >= 100 || stepPct >= 100)
        ? el('p', { class: 'text-muted', style: { textAlign: 'center', marginTop: 'var(--space-3)' } }, '🎉 Goal reached — nicely done.')
        : null
    );

    // --- weekly bars ---
    const water = lastWeek('waterMl');
    const steps = lastWeek('steps');
    const weeklyCard = card('This week',
      el('div', { class: 'field' },
        el('label', {}, '💧 Water (ml)'),
        barChart({ values: water.values, labels: water.labels, goal: cfg.waterMl, color: 'var(--color-water)', height: 140, ariaLabel: 'Water over the last 7 days' })
      ),
      el('div', { class: 'field', style: { marginBottom: 0 } },
        el('label', {}, '🚶 Steps'),
        barChart({ values: steps.values, labels: steps.labels, goal: cfg.steps, color: 'var(--color-primary)', height: 140, ariaLabel: 'Steps over the last 7 days' })
      )
    );

    mount(host, todayCard, weeklyCard);
  }

  render();
  const unsub = store.subscribe(KEY, render);
  const unsub2 = store.subscribe('settings', render);
  return () => { unsub(); unsub2(); };
}

export function getSummary() {
  const cfg = goalsCfg();
  const t = entryFor(today());
  return {
    waterMl: t.waterMl, waterGoal: cfg.waterMl,
    steps: t.steps, stepGoal: cfg.steps,
    waterPct: Math.min(100, Math.round((t.waterMl / cfg.waterMl) * 100)),
    stepPct: Math.min(100, Math.round((t.steps / cfg.steps) * 100)),
  };
}
