// dashboard.js — today-at-a-glance, v2 "Steady": greeting header with streak
// chip, a hero Today card (pain metric or a kind prompt + compact goal rings),
// quick actions, and stat tiles with sparklines. Composes each feature
// module's getSummary() and reuses their logging actions (single source of
// truth). Live updates via the store/event bus. Slots for insights, weekly
// review and flare banner are wired in Phase 6.

import * as store from '../core/store.js';
import { todayKey, addDays, computeStreak, parseKey } from '../core/dates.js';
import { el, mount, clear, card, statTile, toast, pageHeader, celebrate } from '../core/ui.js';
import { icon, postureIcon } from '../core/icons.js';
import { progressRing } from '../core/charts.js';
import * as pain from './pain-trends.js';
import * as goals from './goals.js';
import * as posture from './posture-reminders.js';
import * as postureCamera from './posture-camera.js';
import * as exercises from './exercises.js';
import * as mealLog from './meal-log.js';
import { activeFlare, activeFlareDays, flareDayKeys } from '../core/flare.js';
import { buildInsights } from '../core/insights.js';
import { isReviewReady } from '../core/review.js';

function hasAnyHistory() {
  const nonEmpty = (k) => {
    const v = store.get(k);
    return v && (Array.isArray(v) ? v.length : Object.keys(v).length);
  };
  return nonEmpty('painLog') || nonEmpty('goalsLog') || nonEmpty('postureSelfLog') || nonEmpty('exerciseLog');
}

/** Days (within window) with any logged activity — for an overall streak. */
function activeDayKeys(days = 120) {
  const painLog = store.get('painLog') || {};
  const goalsLog = store.get('goalsLog') || {};
  const postureLog = store.get('postureSelfLog') || {};
  const exLog = store.get('exerciseLog') || {};
  const keys = [];
  for (let i = 0; i < days; i++) {
    const k = addDays(todayKey(), -i);
    const active =
      (painLog[k] && typeof painLog[k].pain === 'number') ||
      (goalsLog[k] && ((goalsLog[k].waterMl || 0) > 0 || (goalsLog[k].steps || 0) > 0)) ||
      (postureLog[k] && postureLog[k].length) ||
      (exLog[k] && exLog[k].length);
    if (active) keys.push(k);
  }
  return keys;
}

function fmtL(ml) {
  return `${(ml / 1000).toFixed(ml % 1000 ? 1 : 0)}L`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// getSummary() defensively — a module shouldn't be able to break the dashboard.
function safeSummary(mod) {
  try { return (mod.getSummary && mod.getSummary()) || {}; } catch (_) { return {}; }
}

/** Last `n` days of some per-day metric, for tile sparklines. */
function seriesOf(days, valueFor) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) out.push(valueFor(addDays(todayKey(), -i)));
  return out;
}

/** Mean of the non-null values, or null. */
function meanOf(values) {
  const real = values.filter((v) => v != null);
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
}

export function init(mountEl) {
  const dateStr = parseKey(todayKey()).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const host = el('div', { class: 'stack' });
  const headerHost = el('div', {});
  let lastStreak = null; // celebrate only when we SEE the streak grow

  mount(mountEl, headerHost, host);

  function renderHeader(streak) {
    clear(headerHost);
    const chip = streak > 0
      ? el('span', { class: 'badge badge--accent streak-chip' }, icon('flame', { size: 15 }), ` ${streak}-day streak`)
      : null;
    mount(headerHost, pageHeader({ title: greeting(), sub: dateStr, actions: chip ? [chip] : [] }));
    return chip;
  }

  function heroCard(p, g) {
    // Left: today's pain (the number that matters most) or a kind prompt.
    const metric = p.logged
      ? el('div', { class: 'hero__metric' },
          el('div', { class: 'hero__value' }, `${p.pain}`, el('span', { class: 'hero__of' }, '/10')),
          el('div', { class: 'hero__label' }, 'pain today'),
          el('div', { class: 'hero__sub' }, `Stiffness ${p.stiffness}/10`))
      : el('div', { class: 'hero__metric' },
          el('div', { class: 'hero__label hero__label--prompt' }, 'How’s your back today?'),
          el('p', { class: 'hero__sub' }, 'One quick entry a day builds your trend.'),
          el('a', { class: 'btn btn--primary', href: '#/pain', style: { marginTop: 'var(--space-3)' } }, icon('edit', { size: 16 }), 'Log how it feels'));

    // Right: compact goal rings with one-tap adders.
    const cfg = goals.config();
    const ringBlock = (ring, addBtn) => el('div', { class: 'hero__ring' }, ring, addBtn);
    const rings = el('div', { class: 'hero__rings' },
      ringBlock(
        progressRing({ value: g.waterMl, max: g.waterGoal, size: 86, stroke: 9, color: 'var(--color-water)', label: 'Water', center: fmtL(g.waterMl), sub: 'water', animate: true }),
        el('button', { class: 'btn btn--sm', 'aria-label': `Add ${cfg.waterStepMl} ml water`, onClick: () => { goals.addWater(cfg.waterStepMl); } }, icon('plus', { size: 14 }), `${cfg.waterStepMl}ml`)
      ),
      ringBlock(
        progressRing({ value: g.steps, max: g.stepGoal, size: 86, stroke: 9, color: 'var(--color-primary)', label: 'Steps', center: g.steps >= 1000 ? `${(g.steps / 1000).toFixed(1)}k` : String(g.steps), sub: 'steps', animate: true }),
        el('button', { class: 'btn btn--sm', 'aria-label': 'Add 1000 steps', onClick: () => { goals.addSteps(1000); } }, icon('plus', { size: 14 }), '1k')
      )
    );

    return el('section', { class: 'card hero' }, metric, rings);
  }

  function quickActions() {
    const postureMini = el('div', { class: 'posture-mini', role: 'group', 'aria-label': 'Quick posture check-in' },
      ...[1, 2, 3, 4, 5].map((r) =>
        el('button', {
          'aria-label': `Posture: ${posture.RATINGS[r].label}`, title: posture.RATINGS[r].label,
          onClick: () => { posture.logPosture(r); toast(`Posture: ${posture.RATINGS[r].label}.`, { type: 'success', duration: 1800 }); },
        }, postureIcon(r, { size: 22 })))
    );

    return card('Quick log',
      el('div', { class: 'quicklog quick-actions' },
        el('div', { class: 'quicklog__group' },
          el('span', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } }, 'Posture:'),
          postureMini
        ),
        el('div', { class: 'quicklog__sep', 'aria-hidden': 'true' }),
        el('a', { class: 'btn btn--ghost', href: '#/pain' }, icon('edit', { size: 16 }), 'Log pain'),
        el('a', { class: 'btn btn--ghost', href: '#/posture' }, icon('video', { size: 16 }), 'Camera check'),
        !activeFlare(store.get('flareLog') || [])
          ? el('a', { class: 'btn btn--ghost', href: '#/flare' }, icon('zap', { size: 16 }), 'Having a flare-up?')
          : null
      )
    );
  }

  function render() {
    clear(host);

    const p = safeSummary(pain);
    const g = safeSummary(goals);
    const po = safeSummary(posture);
    const ex = safeSummary(exercises);
    const ml = safeSummary(mealLog);
    const grace = (store.get('settings') || {}).streakGrace ?? 1;
    // Flare days count as active — a flare must never break the streak.
    const flareLog = store.get('flareLog') || [];
    const streakDays = new Set(activeDayKeys());
    for (const k of flareDayKeys(flareLog, todayKey())) streakDays.add(k);
    const streak = computeStreak([...streakDays], todayKey(), { grace });

    const chip = renderHeader(streak);
    if (lastStreak != null && streak > lastStreak && chip) celebrate(chip);
    lastStreak = streak;

    // --- flare banner ------------------------------------------------------------
    const flare = activeFlare(flareLog);
    if (flare) {
      const days = activeFlareDays(flareLog, todayKey());
      mount(host, el('a', { class: 'flare-banner', href: '#/flare' },
        icon('zap', { size: 18 }),
        el('span', {}, el('strong', {}, `Flare mode — day ${days}. `),
          'Goals are reduced and your streak is protected.'),
        el('span', { class: 'flare-banner__cta' }, 'Open →')));
    }

    if (!hasAnyHistory()) {
      mount(host, card('Welcome to Upright',
        el('p', {}, 'This is your private space to look after your back — log how you feel, '
          + 'keep up gentle movement and water, and watch your trends. Everything stays on this device.'),
        el('p', { class: 'text-muted', style: { marginTop: 'var(--space-3)' } },
          'Start with a quick log below, or open ',
          el('a', { href: '#/pain' }, 'Pain'), ', ',
          el('a', { href: '#/goals' }, 'Walk & water'), ', or ',
          el('a', { href: '#/posture' }, 'Posture'), '.'),
        el('p', { class: 'field__hint', style: { marginTop: 'var(--space-3)' } },
          'Reminder: Upright is a wellness tool, not medical advice. ',
          el('a', { href: '#/settings' }, 'Disclaimer & safety →'))
      ));
    }

    mount(host, heroCard(p, g), quickActions());

    // --- tiles with sparklines -------------------------------------------------
    const painLog = store.get('painLog') || {};
    const postureLog = store.get('postureSelfLog') || {};
    const exLog = store.get('exerciseLog') || {};
    const mealsLog = store.get('mealLog') || {};

    const painSpark = seriesOf(14, (k) => (painLog[k] && typeof painLog[k].pain === 'number' ? painLog[k].pain : null));
    const recentPain = meanOf(painSpark.slice(7));
    const priorPain = meanOf(painSpark.slice(0, 7));
    let painDelta = null;
    if (recentPain != null && priorPain != null && painSpark.slice(7).filter((v) => v != null).length >= 3 && painSpark.slice(0, 7).filter((v) => v != null).length >= 3) {
      const diff = recentPain - priorPain;
      if (Math.abs(diff) >= 0.4) {
        painDelta = { text: `${diff > 0 ? '+' : ''}${diff.toFixed(1)} vs last wk`, dir: diff > 0 ? 'up' : 'down', good: diff < 0 };
      }
    }

    const postureSpark = seriesOf(7, (k) => {
      const day = postureLog[k];
      return day && day.length ? day.reduce((a, e) => a + e.rating, 0) / day.length : null;
    });
    // A flat all-zero sparkline is noise, not signal — show nothing instead.
    const nonFlat = (vals) => (vals.some((v) => v != null && v !== 0) ? vals : null);
    const exSpark = nonFlat(seriesOf(7, (k) => (exLog[k] ? exLog[k].length : 0)));
    const mealSpark = nonFlat(seriesOf(7, (k) => (mealsLog[k] ? mealsLog[k].length : 0)));

    const tiles = el('div', { class: 'grid' },
      statTile({
        iconName: 'activity', label: 'Pain trend', href: '#/pain',
        value: p.logged ? `${p.pain}/10` : '—',
        sub: p.logged ? `Stiffness ${p.stiffness}/10` : 'Not logged yet',
        accent: p.logged && p.pain >= 7 ? 'var(--color-danger)' : null,
        spark: painSpark, sparkColor: 'var(--color-danger)',
        delta: painDelta,
      }),
      statTile({
        iconName: 'posture-4', label: 'Posture check-ins', href: '#/posture',
        value: String(po.count),
        sub: po.count ? `Last: ${po.lastLabel}` : 'None today',
        spark: postureSpark,
      }),
      statTile({
        iconName: 'dumbbell', label: 'Exercises today', href: '#/exercises',
        value: String(ex.doneToday || 0),
        sub: ex.doneToday ? `of ${ex.total} in library` : 'None done yet',
        accent: ex.doneToday > 0 ? 'var(--color-primary)' : null,
        spark: exSpark,
      }),
      statTile({
        iconName: 'utensils', label: 'Meals logged', href: '#/meals',
        value: String(ml.countToday || 0),
        sub: ml.countToday ? 'today' : 'None logged today',
        spark: mealSpark,
      })
    );

    // Camera tile only appears on days the camera actually monitored.
    const cam = safeSummary(postureCamera);
    if (cam && cam.monitoredMin > 0) {
      tiles.appendChild(statTile({
        iconName: 'video', label: 'Camera posture', href: '#/posture',
        value: cam.pctGood != null ? `${cam.pctGood}%` : '—',
        sub: `good over ${cam.monitoredMin} min${cam.slouchEvents ? ` · ${cam.slouchEvents} slouch alert${cam.slouchEvents === 1 ? '' : 's'}` : ''}`,
        accent: cam.pctGood != null && cam.pctGood >= 75 ? 'var(--color-primary)' : null,
      }));
    }

    // Sleep tile (last night) with a 7-night sparkline.
    const sleepLog = store.get('sleepLog') || {};
    const sleepToday = sleepLog[todayKey()];
    const sleepSpark = seriesOf(7, (k) => (sleepLog[k] && typeof sleepLog[k].hours === 'number' ? sleepLog[k].hours : null));
    tiles.appendChild(statTile({
      iconName: 'moon', label: 'Sleep last night', href: '#/wellbeing',
      value: sleepToday ? `${sleepToday.hours}h` : '—',
      sub: sleepToday
        ? (sleepToday.wokeStiff ? 'woke stiff' : ['', 'rough', 'poor', 'okay', 'good', 'great'][sleepToday.quality] || '')
        : 'Not logged yet',
      spark: sleepSpark, sparkColor: 'var(--violet-400)',
    }));
    mount(host, tiles);

    // --- weekly review prompt + insights card -------------------------------------
    const data = {
      painLog, sleepLog, postureSelfLog: postureLog, goalsLog: store.get('goalsLog'),
      exerciseLog: exLog, postureCamLog: store.get('postureCamLog'),
      activityLog: store.get('activityLog'), flareLog, settings: store.get('settings'),
    };
    const review = isReviewReady(data, todayKey(), (store.get('meta') || {}).lastReviewWeekSeen);
    if (review.ready) {
      mount(host, el('a', { class: 'review-prompt', href: '#/insights' },
        icon('sparkles', { size: 18 }),
        el('span', {}, el('strong', {}, 'Your weekly review is ready. '), 'One win, one focus — 30 seconds.'),
        el('span', { class: 'flare-banner__cta' }, 'Read it →')));
    }

    const ins = buildInsights(data, todayKey(), 3);
    if (ins.top.length) {
      mount(host, card('What your data is saying',
        ...ins.top.map((r) => el('p', { class: 'insight__text', style: { marginBottom: 'var(--space-2)' } }, '· ', r.text)),
        el('a', { href: '#/insights', class: 'field__hint' }, 'All insights →')));
    } else if (ins.locked.length) {
      const hint = ins.locked[0];
      mount(host, card('Insights are warming up',
        el('p', { class: 'text-muted' }, hint.lockedText),
        el('a', { href: '#/insights', class: 'field__hint' }, 'See what else unlocks →')));
    }
  }

  render();
  // Any store change refreshes the at-a-glance view.
  const unsub = store.subscribe('*', render);
  return unsub;
}
