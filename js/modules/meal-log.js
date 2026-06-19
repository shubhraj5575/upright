// meal-log.js — quick-log what you eat, with day-keyed entries, a "today" list
// and a 7-day bar chart of meals logged plus weekly tag tallies. Module
// contract: exports init(mountEl) and getSummary().

import * as store from '../core/store.js';
import { todayKey, addDays, parseKey } from '../core/dates.js';
import { el, mount, clear, card, toast } from '../core/ui.js';
import { barChart } from '../core/charts.js';

const KEY = 'mealLog';

// Quick tag chips offered on the add form (also the canonical order used when
// tallying the weekly badges).
const TAGS = ['anti-inflammatory', 'high-protein', 'calcium', 'vit-d', 'omega-3', 'fiber'];

function log() {
  return store.get(KEY) || {};
}

function todayEntries() {
  return log()[todayKey()] || [];
}

function addMeal(name, tags) {
  const k = todayKey();
  store.update(KEY, (all) => {
    const day = all[k] ? all[k].slice() : [];
    day.push({ name, tags, t: new Date().toISOString() });
    return { ...all, [k]: day };
  });
}

// Delete by timestamp, not list index: the list is rendered newest-first
// (reversed), so an index would point at the wrong row.
function deleteMeal(entry) {
  const k = todayKey();
  store.update(KEY, (all) => {
    const day = (all[k] || []).filter((e) => e.t !== entry.t);
    return { ...all, [k]: day };
  });
}

function timeLabel(iso) {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch (_) {
    return '';
  }
}

export function init(mountEl) {
  const host = el('div', { class: 'stack' });
  mount(mountEl,
    el('div', { class: 'view-header' },
      el('h1', {}, 'Meal log'),
      el('p', {}, 'Quick-log what you eat — tag meals that support recovery and see your week at a glance.')),
    host
  );

  function render() {
    clear(host);

    // --- quick add ---
    const nameInput = el('input', { class: 'input', type: 'text', placeholder: 'What did you eat? e.g. Salmon & spinach' });
    const tagBoxes = TAGS.map((tag) =>
      el('label', { class: 'tag', style: { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' } },
        el('input', { type: 'checkbox', value: tag, dataset: { tag } }),
        tag)
    );

    const addBtn = el('button', { class: 'btn btn--primary', onClick: () => {
      const name = nameInput.value.trim();
      if (!name) {
        toast('Add a meal name first.', { type: 'warn', duration: 2500 });
        return;
      }
      const tags = tagBoxes
        .filter((lbl) => lbl.querySelector('input').checked)
        .map((lbl) => lbl.querySelector('input').value);
      addMeal(name, tags);
      nameInput.value = '';
    } }, 'Add');

    const addCard = card('Quick add',
      el('div', { class: 'field' }, nameInput),
      el('div', { class: 'field' },
        el('label', {}, 'Tags'),
        el('div', { class: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-2)' } }, ...tagBoxes)),
      el('div', { class: 'row', style: { justifyContent: 'flex-end' } }, addBtn)
    );

    // --- today ---
    const entries = todayEntries();
    let todayBody;
    if (!entries.length) {
      todayBody = el('div', { class: 'empty' },
        el('div', { class: 'empty__icon', 'aria-hidden': 'true' }, '🍽️'),
        el('div', { class: 'empty__title' }, 'No meals logged today'),
        el('p', {}, 'Add your first meal above — it only takes a second.'));
    } else {
      todayBody = el('div', { class: 'stack' },
        ...entries.slice().reverse().map((e) =>
          el('div', { class: 'row row--between', style: { alignItems: 'flex-start', gap: 'var(--space-3)' } },
            el('div', { class: 'stack', style: { gap: 'var(--space-1)' } },
              el('strong', {}, e.name),
              (e.tags && e.tags.length)
                ? el('div', { class: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-1)' } },
                    ...e.tags.map((t) => el('span', { class: 'tag' }, t)))
                : null,
              el('span', { class: 'text-faint', style: { fontSize: 'var(--text-xs)' } }, timeLabel(e.t))),
            el('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Delete ${e.name}`, onClick: () => deleteMeal(e) }, '×')))
      );
    }
    const todayCard = card('Today', todayBody);

    // --- this week ---
    const keys = [];
    for (let i = 6; i >= 0; i--) keys.push(addDays(todayKey(), -i));
    const counts = keys.map((k) => (log()[k] || []).length);
    const labels = keys.map((k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'narrow' }));

    const tagCounts = {};
    keys.forEach((k) => {
      (log()[k] || []).forEach((e) => {
        (e.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
      });
    });
    const tagBadges = TAGS
      .filter((t) => tagCounts[t])
      .map((t) => el('span', { class: 'badge badge--primary' }, `${t} × ${tagCounts[t]}`));

    const weekCard = card('This week',
      barChart({ values: counts, labels, color: 'var(--color-primary)', height: 140, ariaLabel: 'Meals logged over the last 7 days' }),
      tagBadges.length
        ? el('div', { class: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-4)' } }, ...tagBadges)
        : el('p', { class: 'text-muted', style: { marginTop: 'var(--space-3)' } }, 'Tag totals will appear here as you log tagged meals.')
    );

    mount(host, addCard, todayCard, weekCard);
  }

  render();
  return store.subscribe(KEY, render);
}

export function getSummary() {
  return { countToday: (store.get(KEY)[todayKey()] || []).length };
}
