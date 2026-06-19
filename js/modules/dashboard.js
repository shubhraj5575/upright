// dashboard.js — today-at-a-glance. Composes each feature module's getSummary()
// and reuses their logging actions for quick-log (single source of truth). Live
// updates via the store/event bus. Module contract: exports init(mountEl).

import * as store from '../core/store.js';
import { todayKey, addDays, computeStreak, parseKey } from '../core/dates.js';
import { el, mount, clear, card, statTile, toast } from '../core/ui.js';
import * as pain from './pain-trends.js';
import * as goals from './goals.js';
import * as posture from './posture-reminders.js';

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

export function init(mountEl) {
  const dateStr = parseKey(todayKey()).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const host = el('div', { class: 'stack' });

  mount(mountEl,
    el('div', { class: 'view-header' }, el('h1', {}, 'Today'), el('p', {}, dateStr)),
    host
  );

  function quickLogCard() {
    const cfg = goals.config();
    const postureMini = el('div', { class: 'posture-mini', role: 'group', 'aria-label': 'Quick posture check-in' },
      ...[1, 2, 3, 4, 5].map((r) =>
        el('button', {
          'aria-label': `Posture: ${posture.RATINGS[r].label}`, title: posture.RATINGS[r].label,
          onClick: () => { posture.logPosture(r); toast(`Posture: ${posture.RATINGS[r].label}.`, { type: 'success', duration: 1800 }); },
        }, posture.RATINGS[r].emoji))
    );

    return card('Quick log',
      el('div', { class: 'quicklog' },
        el('div', { class: 'quicklog__group' },
          el('button', { class: 'btn', onClick: () => { goals.addWater(cfg.waterStepMl); toast(`+${cfg.waterStepMl} ml water.`, { type: 'success', duration: 1800 }); } }, `💧 +${cfg.waterStepMl} ml`),
          el('button', { class: 'btn', onClick: () => { goals.addSteps(1000); toast('+1,000 steps.', { type: 'success', duration: 1800 }); } }, '🚶 +1,000 steps')
        ),
        el('div', { class: 'quicklog__sep', 'aria-hidden': 'true' }),
        el('div', { class: 'quicklog__group' },
          el('span', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } }, 'Posture:'),
          postureMini
        ),
        el('div', { class: 'quicklog__sep', 'aria-hidden': 'true' }),
        el('a', { class: 'btn btn--ghost', href: '#/pain' }, '📝 Log pain')
      )
    );
  }

  function render() {
    clear(host);

    const p = pain.getSummary();
    const g = goals.getSummary();
    const po = posture.getSummary();
    const streak = computeStreak(activeDayKeys(), todayKey());

    if (!hasAnyHistory()) {
      mount(host, card('Welcome to Upright 👋',
        el('p', {}, 'This is your private space to protect your back day to day — log how you feel, '
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

    mount(host, quickLogCard());

    const tiles = el('div', { class: 'grid' },
      statTile({
        icon: '📈', label: 'Pain today', href: '#/pain',
        value: p.logged ? `${p.pain}/10` : '—',
        sub: p.logged ? `Stiffness ${p.stiffness}/10` : 'Not logged yet',
        accent: p.logged && p.pain >= 7 ? 'var(--color-danger)' : null,
      }),
      statTile({
        icon: '🧍', label: 'Posture check-ins', href: '#/posture',
        value: String(po.count),
        sub: po.count ? `Last: ${po.lastLabel}` : 'None today',
      }),
      statTile({
        icon: '💧', label: 'Water', href: '#/goals',
        value: fmtL(g.waterMl),
        sub: `${g.waterPct}% of ${fmtL(g.waterGoal)}`,
        accent: g.waterPct >= 100 ? 'var(--color-water)' : null,
      }),
      statTile({
        icon: '🚶', label: 'Steps', href: '#/goals',
        value: g.steps.toLocaleString(),
        sub: `${g.stepPct}% of ${g.stepGoal.toLocaleString()}`,
        accent: g.stepPct >= 100 ? 'var(--color-primary)' : null,
      })
    );
    mount(host, tiles);

    if (streak > 0) {
      mount(host, el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('span', { class: 'badge badge--accent', style: { fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)' } },
          `🔥 ${streak}-day logging streak`)));
    }
  }

  render();
  // Any store change refreshes the at-a-glance view.
  const unsub = store.subscribe('*', render);
  return unsub;
}
