// goals.js — daily walk (steps) & water goals with rings, streaks and a weekly
// bar chart. Module contract: exports init(mountEl) and getSummary().

import * as store from '../core/store.js';
import { todayKey, addDays, parseKey, computeStreak } from '../core/dates.js';
import { el, mount, clear, card, toast, pageHeader, celebrate, setFieldError } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { progressRing, barChart } from '../core/charts.js';
import { activeFlare, adjustedGoals } from '../core/flare.js';
import { summarizeDay } from './cam-session.js';

const KEY = 'goalsLog';
const ACT_KEY = 'activityLog';
const BREAK_TARGET_MIN = 45; // aim: one break per 45 min of sitting

function goalsCfg() {
  const s = store.get('settings') || {};
  const g = s.goals || {};
  const base = { waterMl: g.waterMl || 2000, waterStepMl: g.waterStepMl || 250, steps: g.steps || 6000 };
  // During a flare the movement target shrinks (hydration stays as-is).
  const flare = activeFlare(store.get('flareLog') || []);
  return adjustedGoals(base, !!flare, (s.flare || {}).goalReductionPct ?? 50);
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

// --- sitting / breaks balance -------------------------------------------------
// Manual estimates, with the camera as an honest floor when it ran today:
// monitored time IS desk time, and away-detections are real breaks.

function activityToday() {
  const a = (store.get(ACT_KEY) || {})[todayKey()] || {};
  return { sittingMin: a.sittingMin || 0, breaks: a.breaks || 0 };
}

function patchActivity(mutator) {
  const k = todayKey();
  store.update(ACT_KEY, (all) => {
    const cur = { sittingMin: 0, breaks: 0, ...((all || {})[k] || {}) };
    mutator(cur);
    cur.sittingMin = Math.max(0, Math.min(18 * 60, cur.sittingMin));
    cur.breaks = Math.max(0, Math.min(60, cur.breaks));
    return { ...(all || {}), [k]: cur };
  });
}

/** Exported so the movement-break reminder's "I moved" action can log a break. */
export function logBreak() {
  patchActivity((a) => { a.breaks += 1; });
}

/** Effective sitting picture for today (manual + camera floor). */
export function sittingBalance() {
  const manual = activityToday();
  const camDay = (store.get('postureCamLog') || {})[todayKey()];
  const cam = camDay ? summarizeDay(camDay) : null;
  const sittingMin = Math.max(manual.sittingMin, cam ? cam.monitoredMin : 0);
  const breaks = manual.breaks + (cam ? cam.awayCount : 0);
  const targetBreaks = Math.floor(sittingMin / BREAK_TARGET_MIN);
  return { sittingMin, breaks, targetBreaks, camFloor: !!cam && cam.monitoredMin > manual.sittingMin, camBreaks: cam ? cam.awayCount : 0 };
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
  let prevWaterPct = null;
  let prevStepPct = null;
  mount(mountEl,
    pageHeader({ title: 'Walk & water', sub: 'Small daily goals that support recovery — gentle movement and staying hydrated.' }),
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
        sub: `of ${(cfg.waterMl / 1000).toFixed(1)}L`, label: 'Water', animate: true,
      }),
      el('div', { class: 'ring-block__label' }, icon('droplet', { size: 16 }), ' Water'),
      el('div', { class: 'ring-block__actions' },
        el('button', { class: 'btn btn--sm', onClick: () => addWater(cfg.waterStepMl) }, `+${cfg.waterStepMl} ml`),
        el('button', { class: 'btn btn--sm', onClick: () => addWater(500) }, '+500 ml'),
        el('button', { class: 'btn btn--sm btn--ghost', 'aria-label': `Remove ${cfg.waterStepMl} ml`, onClick: () => addWater(-cfg.waterStepMl) }, '−')
      )
    );

    const stepInput = el('input', { class: 'input', type: 'number', min: '0', step: '100', placeholder: 'e.g. 1500', style: { maxWidth: '120px' }, 'aria-label': 'Steps to add' });
    const stepField = el('div', { class: 'field', style: { marginBottom: 0 } }, stepInput);
    const stepBlock = el('div', { class: 'ring-block' },
      progressRing({
        value: t.steps, max: cfg.steps, color: 'var(--color-primary)',
        center: t.steps.toLocaleString(), sub: `of ${cfg.steps.toLocaleString()}`, label: 'Steps', animate: true,
      }),
      el('div', { class: 'ring-block__label' }, icon('walk', { size: 16 }), ' Steps'),
      el('div', { class: 'ring-block__actions' },
        el('button', { class: 'btn btn--sm', onClick: () => addSteps(1000) }, '+1,000'),
        stepField,
        el('button', { class: 'btn btn--sm btn--primary', onClick: () => {
          const v = Number(stepInput.value);
          if (!stepInput.value.trim() || Number.isNaN(v) || v <= 0 || v > 100000) {
            setFieldError(stepField, 'Enter a step count between 1 and 100,000.');
            return;
          }
          setFieldError(stepField, null);
          addSteps(Math.round(v));
          stepInput.value = '';
        } }, 'Add')
      )
    );

    const streakRow = el('div', { class: 'row', style: { justifyContent: 'center', marginTop: 'var(--space-4)' } },
      el('span', { class: 'badge badge--accent' }, icon('droplet', { size: 13 }), ` ${waterStreak}-day water streak`),
      el('span', { class: 'badge badge--primary' }, icon('walk', { size: 13 }), ` ${stepStreak}-day step streak`)
    );

    const todayCard = card('Today',
      cfg.reduced
        ? el('div', { class: 'callout', style: { marginBottom: 'var(--space-4)' } },
            el('p', {}, el('strong', {}, 'Flare mode: '), `your step goal is reduced by ${cfg.reductionPct}% (to ${cfg.steps.toLocaleString()}) until the flare ends. `,
              el('a', { href: '#/flare' }, 'Manage →')))
        : null,
      el('div', { class: 'ring-group' }, waterBlock, stepBlock),
      streakRow,
      (waterPct >= 100 || stepPct >= 100)
        ? el('p', { class: 'text-muted', style: { textAlign: 'center', marginTop: 'var(--space-3)' } }, 'Goal reached — nicely done.')
        : null
    );

    // --- weekly bars ---
    const water = lastWeek('waterMl');
    const steps = lastWeek('steps');
    const weeklyCard = card('This week',
      el('div', { class: 'field' },
        el('label', {}, 'Water (ml)'),
        barChart({ values: water.values, labels: water.labels, goal: cfg.waterMl, color: 'var(--color-water)', height: 140, ariaLabel: 'Water over the last 7 days', interactive: true, tipFormat: (v) => `${v} ml` })
      ),
      el('div', { class: 'field', style: { marginBottom: 0 } },
        el('label', {}, 'Steps'),
        barChart({ values: steps.values, labels: steps.labels, goal: cfg.steps, color: 'var(--color-primary)', height: 140, ariaLabel: 'Steps over the last 7 days', interactive: true, tipFormat: (v) => v.toLocaleString() })
      )
    );

    // --- sitting balance ---
    const bal = sittingBalance();
    const balanceMsg = bal.sittingMin === 0
      ? 'Estimate your desk time with one tap — breaks matter as much as steps for a recovering back.'
      : bal.breaks >= bal.targetBreaks
        ? `${bal.breaks} break${bal.breaks === 1 ? '' : 's'} over ~${(bal.sittingMin / 60).toFixed(1)}h of sitting — on target (aim: one per ${BREAK_TARGET_MIN} min).`
        : `${bal.breaks} break${bal.breaks === 1 ? '' : 's'} over ~${(bal.sittingMin / 60).toFixed(1)}h of sitting — aim for ${bal.targetBreaks} (one per ${BREAK_TARGET_MIN} min).`;
    const sittingCard = card('Sitting & breaks',
      el('p', { class: 'card__subtitle' }, balanceMsg),
      el('div', { class: 'row', style: { marginBottom: 'var(--space-3)' } },
        el('span', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } }, 'Sat today:'),
        ...[2, 4, 6, 8].map((h) => el('button', {
          class: 'btn btn--sm' + (Math.round(bal.sittingMin / 60) === h ? ' btn--primary' : ''),
          onClick: () => patchActivity((a) => { a.sittingMin = h * 60; }),
        }, `~${h}h`)),
        el('button', { class: 'btn btn--sm btn--ghost', onClick: () => patchActivity((a) => { a.sittingMin += 30; }) }, '+30m')),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onClick: () => { logBreak(); toast('Break logged — good.', { type: 'success', duration: 1500 }); } },
          icon('walk', { size: 16 }), 'I stood up / moved'),
        bal.camBreaks ? el('span', { class: 'field__hint' }, `includes ${bal.camBreaks} auto-detected by the camera`) : null)
    );

    mount(host, todayCard, sittingCard, weeklyCard);

    // Celebrate the moment a goal crosses the line (not on every re-render).
    if (prevWaterPct != null && prevWaterPct < 100 && waterPct >= 100) celebrate(waterBlock);
    if (prevStepPct != null && prevStepPct < 100 && stepPct >= 100) celebrate(stepBlock);
    prevWaterPct = waterPct;
    prevStepPct = stepPct;
  }

  render();
  const unsub = store.subscribe(KEY, render);
  const unsub2 = store.subscribe('settings', render);
  const unsub3 = store.subscribe('flareLog', render);
  const unsub4 = store.subscribe(ACT_KEY, render);
  return () => { unsub(); unsub2(); unsub3(); unsub4(); };
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
