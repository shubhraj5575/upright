// posture-reminders.js — posture self-log (Phase 1). The timed movement-break
// reminders + notifications wiring land in Phase 2 (core/notify.js); the
// optional camera posture AI is Phase 5. For now this is a fast 1-tap check-in.
// Module contract: exports init(mountEl) and getSummary().

import * as store from '../core/store.js';
import { todayKey } from '../core/dates.js';
import { el, mount, clear, card, toast } from '../core/ui.js';

const KEY = 'postureSelfLog';

// Higher = better posture. Index 0 unused so rating maps 1..5 directly.
const RATINGS = [
  null,
  { emoji: '🙇', label: 'Slumped' },
  { emoji: '😣', label: 'Poor' },
  { emoji: '😐', label: 'Okay' },
  { emoji: '🙂', label: 'Good' },
  { emoji: '🧍', label: 'Tall' },
];

function todayEntries() {
  const all = store.get(KEY) || {};
  return all[todayKey()] || [];
}

// Exported so the dashboard's quick posture check-in reuses this logic.
export function logPosture(rating) {
  const k = todayKey();
  store.update(KEY, (all) => {
    const day = all[k] ? all[k].slice() : [];
    day.push({ t: new Date().toISOString(), rating });
    return { ...all, [k]: day };
  });
}

export { RATINGS };

function timeLabel(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

export function init(mountEl) {
  const listHost = el('div', {});

  const ratingBtns = el('div', { class: 'posture-scale' },
    ...[1, 2, 3, 4, 5].map((r) =>
      el('button', {
        class: 'btn posture-btn', 'aria-label': `Log posture: ${RATINGS[r].label}`,
        onClick: () => { logPosture(r); toast(`Logged: ${RATINGS[r].label}.`, { type: 'success', duration: 2000 }); },
      },
        el('span', { class: 'posture-btn__emoji', 'aria-hidden': 'true' }, RATINGS[r].emoji),
        el('span', { class: 'posture-btn__label' }, RATINGS[r].label))
    )
  );

  const logCard = card('How’s your posture right now?',
    el('p', { class: 'card__subtitle' }, 'A quick honest check-in. Tap one — it takes a second and builds awareness.'),
    ratingBtns
  );

  const todayCard = card('Today’s check-ins', listHost);

  function renderList() {
    clear(listHost);
    const entries = todayEntries();
    if (!entries.length) {
      mount(listHost, el('div', { class: 'empty' },
        el('div', { class: 'empty__icon', 'aria-hidden': 'true' }, '🪑'),
        el('div', { class: 'empty__title' }, 'No check-ins yet today'),
        el('p', {}, 'Your posture ratings will appear here.')
      ));
      return;
    }
    const avg = (entries.reduce((a, e) => a + e.rating, 0) / entries.length).toFixed(1);
    mount(listHost,
      el('div', { class: 'row row--between', style: { marginBottom: 'var(--space-3)' } },
        el('span', { class: 'text-muted' }, `${entries.length} check-in${entries.length === 1 ? '' : 's'} today`),
        el('span', { class: 'badge badge--primary' }, `avg ${avg} / 5`)
      ),
      el('ul', { class: 'posture-list' },
        ...entries.slice().reverse().map((e) =>
          el('li', { class: 'posture-list__item' },
            el('span', { 'aria-hidden': 'true' }, RATINGS[e.rating] ? RATINGS[e.rating].emoji : '•'),
            el('span', {}, RATINGS[e.rating] ? RATINGS[e.rating].label : `Rating ${e.rating}`),
            el('span', { class: 'text-faint', style: { marginLeft: 'auto' } }, timeLabel(e.t))
          )
        )
      )
    );
  }

  mount(mountEl,
    el('div', { class: 'view-header' },
      el('h1', {}, 'Posture'),
      el('p', {}, 'Quick self-check-ins now. Timed movement-break reminders arrive in a later phase.')),
    logCard,
    todayCard
  );
  renderList();

  const unsub = store.subscribe(KEY, renderList);
  return unsub;
}

export function getSummary() {
  const entries = todayEntries();
  const last = entries.length ? entries[entries.length - 1].rating : null;
  return {
    count: entries.length,
    lastRating: last,
    lastLabel: last && RATINGS[last] ? RATINGS[last].label : null,
    avg: entries.length ? entries.reduce((a, e) => a + e.rating, 0) / entries.length : null,
  };
}
