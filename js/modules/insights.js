// insights.js (view) — the weekly review up top, then every unlocked pattern
// grouped by theme, then the locked ones with what-to-log hints. All content
// comes from the pure engines (core/insights.js, core/review.js); this file
// only renders. Opening the view marks the current review as seen.

import * as store from '../core/store.js';
import { todayKey } from '../core/dates.js';
import { el, mount, clear, card, pageHeader, emptyState } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { buildInsights, GROUPS } from '../core/insights.js';
import { buildWeeklyReview, isReviewReady, weekStartKey } from '../core/review.js';
import { parseKey } from '../core/dates.js';

function dataset() {
  return {
    painLog: store.get('painLog'), sleepLog: store.get('sleepLog'),
    postureSelfLog: store.get('postureSelfLog'), goalsLog: store.get('goalsLog'),
    exerciseLog: store.get('exerciseLog'), postureCamLog: store.get('postureCamLog'),
    activityLog: store.get('activityLog'), flareLog: store.get('flareLog'),
    settings: store.get('settings'),
  };
}

const STRENGTH_LABEL = { strong: 'clear pattern', moderate: 'emerging pattern', weak: 'early signal' };

function insightRow(r) {
  return el('div', { class: 'insight' },
    el('span', { class: `insight__badge insight__badge--${r.strength}` }, STRENGTH_LABEL[r.strength] || 'pattern'),
    el('p', { class: 'insight__text' }, r.text));
}

function lockedRow(r) {
  return el('div', { class: 'insight insight--locked' },
    el('span', { class: 'insight__lock', 'aria-hidden': 'true' }, icon('lock', { size: 14 })),
    el('p', { class: 'insight__text' }, r.lockedText));
}

function reviewCard(data, today) {
  const rev = buildWeeklyReview(data, today);
  if (rev.current.loggedDays < 3) return null; // nothing honest to show yet
  const weekLabel = parseKey(rev.weekKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const deltaRow = el('div', { class: 'review-deltas' },
    ...rev.deltas.map((d) => el('div', { class: 'review-delta' },
      el('span', { class: 'review-delta__value' },
        d.current,
        d.dir ? el('span', {
          class: 'review-delta__dir ' + (d.good ? 'review-delta__dir--good' : 'review-delta__dir--bad'),
          'aria-label': d.dir === 'up' ? 'up vs prior week' : 'down vs prior week',
        }, icon(d.dir === 'up' ? 'trending-up' : 'trending-down', { size: 14 })) : null),
      el('span', { class: 'review-delta__label' }, d.label,
        d.previous != null ? el('span', { class: 'text-faint' }, ` (was ${d.previous})`) : null))));

  return card(null,
    el('div', { class: 'row row--between', style: { marginBottom: 'var(--space-3)' } },
      el('h2', { class: 'card__title', style: { marginBottom: 0 } }, 'Your week in review'),
      el('span', { class: 'badge' }, `week of ${weekLabel}`)),
    rev.flareWeek ? el('p', { class: 'card__subtitle' }, 'A flare week — numbers below are kept gentle.') : null,
    deltaRow,
    el('div', { class: 'callout', style: { marginTop: 'var(--space-4)' } },
      el('p', {}, el('strong', {}, 'The win: '), rev.win)),
    el('div', { class: 'callout', style: { marginTop: 'var(--space-3)' } },
      el('p', {}, el('strong', {}, 'One focus: '), rev.focus))
  );
}

export function init(mountEl) {
  const host = el('div', { class: 'stack' });
  mount(mountEl,
    pageHeader({
      title: 'Insights',
      sub: 'Patterns from your own logs — observations, not diagnoses. More logging sharpens them.',
    }),
    host
  );

  function render() {
    clear(host);
    const today = todayKey();
    const data = dataset();

    // Mark this week's review as seen (clears the dashboard prompt).
    const { weekKey } = isReviewReady(data, today, (store.get('meta') || {}).lastReviewWeekSeen);
    const seen = (store.get('meta') || {}).lastReviewWeekSeen;
    if (seen !== weekKey) {
      store.update('meta', (m) => ({ ...(m || {}), lastReviewWeekSeen: weekKey }));
    }

    mount(host, reviewCard(data, today));

    const res = buildInsights(data, today, 3);
    if (!res.unlocked.length && !res.locked.length) {
      mount(host, emptyState({ icon: 'lightbulb', title: 'No insights yet', body: 'Start logging and patterns will surface here.' }));
      return;
    }

    for (const g of GROUPS) {
      const rows = res.unlocked.filter((r) => r.group === g.id);
      if (!rows.length) continue;
      mount(host, card(g.label, ...rows.map(insightRow)));
    }

    const locked = res.locked;
    if (locked.length) {
      mount(host, card('Locked — more logging unlocks these',
        el('p', { class: 'card__subtitle' }, 'Each of these needs enough days on both sides of a comparison to be honest.'),
        ...locked.map(lockedRow)));
    }

    mount(host, el('p', { class: 'field__hint', style: { textAlign: 'center' } },
      'These are associations in your own data, with small sample sizes. They are food for thought — not medical findings.'));
  }

  render();
  const unsub = store.subscribe('*', () => { /* insights are computed on entry; no live churn */ });
  return unsub;
}

export function getSummary() {
  const res = buildInsights(dataset(), todayKey(), 3);
  return { unlocked: res.unlocked.length, top: res.top };
}
