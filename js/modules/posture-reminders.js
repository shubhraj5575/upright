// posture-reminders.js — posture self-log (Phase 1). The timed movement-break
// reminders + notifications wiring land in Phase 2 (core/notify.js); the
// optional camera posture AI is Phase 5. For now this is a fast 1-tap check-in.
// Module contract: exports init(mountEl) and getSummary().

import * as store from '../core/store.js';
import { todayKey } from '../core/dates.js';
import { el, mount, clear, card, toast } from '../core/ui.js';
import * as notify from '../core/notify.js';

const KEY = 'postureSelfLog';
const STATE_KEY = 'reminderState'; // transient last-fired times (not exported)

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

// --- reminder engine ------------------------------------------------------
// Runs app-wide (started at boot), independent of which view is open. Fires a
// posture check and a movement break on their own cadences during active
// hours. State (last-fired) lives in its own store key so it doesn't churn the
// settings subscribers. On refocus we tick immediately to catch up a reminder
// that a throttled background timer missed (fired once, not repeatedly).
let timer = null;

function reminderCfg() {
  return (store.get('settings') || {}).reminders || {};
}
function getState() {
  return store.get(STATE_KEY) || {};
}
function setLast(field, iso) {
  store.update(STATE_KEY, (st) => ({ ...(st || {}), [field]: iso }));
}

function withinActiveHours(now, r) {
  if (!r.activeHours) return true;
  const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = toMin(r.activeHours.start || '00:00');
  const end = toMin(r.activeHours.end || '23:59');
  return start <= end ? mins >= start && mins <= end : mins >= start || mins <= end;
}

function tick() {
  const r = reminderCfg();
  if (!r.enabled) return;
  const now = new Date();
  if (!withinActiveHours(now, r)) return;
  const nowMs = now.getTime();
  const st = getState();

  const check = (field, intervalMin, title, body) => {
    if (!intervalMin || intervalMin <= 0) return;
    const last = st[field] ? new Date(st[field]).getTime() : 0;
    if (!last) { setLast(field, now.toISOString()); return; } // seed, don't fire instantly
    if (nowMs - last >= intervalMin * 60000) {
      notify.fire(title, { body, type: 'warn', onClick: () => { location.hash = '#/posture'; } });
      setLast(field, now.toISOString());
    }
  };

  check('lastPostureAt', r.postureIntervalMin, '🪑 Posture check', 'Sit tall — relax your shoulders and ease your lower back.');
  check('lastMovementAt', r.movementIntervalMin, '🚶 Movement break', 'Stand up and move for a minute to unload your back.');
}

/** Start the global reminder loop. Safe to call once at boot. */
export function startReminders() {
  if (timer) return;
  timer = setInterval(tick, 30000); // 30s heartbeat
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('focus', tick);
  tick();
}

/** Reset last-fired times (so toggling reminders on starts a fresh interval). */
export function resetReminderClock() {
  const now = new Date().toISOString();
  store.set(STATE_KEY, { lastPostureAt: now, lastMovementAt: now });
}

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

  const r = (store.get('settings') || {}).reminders || {};
  const reminderInfo = el('div', { class: 'callout', style: { marginBottom: 'var(--space-4)' } },
    r.enabled
      ? el('span', {}, `🔔 Reminders on — posture every ${r.postureIntervalMin} min, movement every ${r.movementIntervalMin} min, ${r.activeHours.start}–${r.activeHours.end}. `)
      : el('span', {}, '🔕 Movement-break reminders are off. '),
    el('a', { href: '#/settings' }, r.enabled ? 'Adjust in Settings →' : 'Turn on in Settings →')
  );

  mount(mountEl,
    el('div', { class: 'view-header' },
      el('h1', {}, 'Posture'),
      el('p', {}, 'Quick self-check-ins, timed movement-break reminders, and (below) optional camera posture AI.')),
    reminderInfo,
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
