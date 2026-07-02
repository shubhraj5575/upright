// flare.js (view) — start, ride out, and end a flare-up. While a flare is
// active: goals shrink, the streak is protected, camera alerts go quiet, and
// this view leads with calm guidance (including the red-flag list, verbatim
// from Settings). History shows the honest pattern: flares end.

import * as store from '../core/store.js';
import { todayKey } from '../core/dates.js';
import { el, mount, clear, card, toast, pageHeader, slider, confirmDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { barChart } from '../core/charts.js';
import {
  activeFlare, startFlare, endFlare, activeFlareDays, flareHistoryStats,
  RED_FLAG_TITLE, RED_FLAG_BODY,
} from '../core/flare.js';

const KEY = 'flareLog';

function flareLog() {
  return store.get(KEY) || [];
}

function guidanceCard() {
  return card('While it lasts',
    el('ul', { class: 'stack', style: { gap: 'var(--space-2)', margin: 0, paddingLeft: 'var(--space-5)' } },
      el('li', {}, 'Flares are common in recovery and almost always settle. Yours have ended before — this one will too.'),
      el('li', {}, 'Keep moving gently within comfort: short walks beat bed rest for most backs.'),
      el('li', {}, 'Your daily goals are reduced automatically — meeting the smaller target still counts.'),
      el('li', {}, 'Follow the flare advice your physiotherapist gave you. If in doubt, ask them.')),
    el('div', { class: 'callout callout--warn', style: { marginTop: 'var(--space-4)' } },
      el('div', { class: 'callout__title' }, `⚠ ${RED_FLAG_TITLE}`),
      el('p', {}, RED_FLAG_BODY))
  );
}

function historyCard() {
  const stats = flareHistoryStats(flareLog());
  if (!stats) return null;
  return card('Your flares end',
    el('p', { class: 'card__subtitle' },
      `All ${stats.count} recorded flare-up${stats.count === 1 ? '' : 's'} ended, lasting ${stats.avgDays} day${stats.avgDays === 1 ? '' : 's'} on average.`),
    stats.durations.length >= 2
      ? barChart({
          values: stats.durations,
          labels: stats.durations.map((_, i) => `#${i + 1}`),
          color: 'var(--color-primary)', height: 130,
          ariaLabel: 'Duration of past flare-ups in days',
          interactive: true, tipFormat: (v) => `${v} day${v === 1 ? '' : 's'}`,
        })
      : null
  );
}

function startCard() {
  const sev = slider({
    id: 'flare-sev', label: 'How bad is it right now?', min: 0, max: 10, step: 1, value: 6,
    format: (v) => `${v}/10`, anchors: ['Niggle', 'Bad', 'Worst'],
  });
  const trigger = el('input', { class: 'input', placeholder: 'e.g. long car ride, lifting, no idea' });
  const notes = el('textarea', { class: 'textarea', rows: 2, placeholder: 'Anything else worth remembering later? (optional)' });

  return card('Starting a flare-up?',
    el('p', { class: 'card__subtitle' },
      'Flare mode shrinks your daily goals, protects your streak, and quiets camera alerts until you end it.'),
    sev.field,
    el('div', { class: 'field' }, el('label', {}, 'Likely trigger (optional)'), trigger),
    el('div', { class: 'field' }, el('label', {}, 'Notes'), notes),
    el('button', { class: 'btn btn--primary', onClick: () => {
      store.update(KEY, (log) => startFlare(log, {
        severity: sev.get(), trigger: trigger.value, notes: notes.value,
        now: new Date().toISOString(), today: todayKey(),
      }));
      toast('Flare mode is on. Be kind to yourself.', { type: 'info' });
    } }, icon('zap', { size: 16 }), 'Start flare mode')
  );
}

function activeCard(f) {
  const days = activeFlareDays(flareLog(), todayKey());
  const reduction = ((store.get('settings') || {}).flare || {}).goalReductionPct ?? 50;
  return card(null,
    el('div', { class: 'row row--between', style: { marginBottom: 'var(--space-3)' } },
      el('h2', { class: 'card__title', style: { marginBottom: 0 } }, 'Flare mode is on'),
      el('span', { class: 'badge badge--accent' }, `day ${days}`)),
    el('p', { class: 'text-muted' },
      `Started ${new Date(f.startedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`
      + `${f.trigger ? ` · likely trigger: ${f.trigger}` : ''} · severity ${f.severity}/10 at the start.`),
    el('p', { class: 'field__hint', style: { marginTop: 'var(--space-2)' } },
      `Step goal reduced by ${reduction}% · streak protected · camera alerts quiet.`),
    el('div', { class: 'row', style: { marginTop: 'var(--space-4)' } },
      el('button', { class: 'btn btn--primary', onClick: async () => {
        const yes = await confirmDialog({
          title: 'End this flare?',
          body: 'Goals return to normal and the episode is added to your history.',
          confirmLabel: 'Feeling better — end it',
        });
        if (!yes) return;
        store.update(KEY, (log) => endFlare(log, { now: new Date().toISOString(), today: todayKey() }));
        toast(`Flare ended after ${days} day${days === 1 ? '' : 's'}. Well ridden out.`, { type: 'success' });
      } }, icon('check', { size: 16 }), 'Feeling better — end this flare'))
  );
}

export function init(mountEl) {
  const host = el('div', { class: 'stack' });
  mount(mountEl,
    pageHeader({ title: 'Flare-up', sub: 'A plan for the bad patches — smaller goals, zero guilt, and a reminder that flares end.' }),
    host
  );
  function render() {
    clear(host);
    const f = activeFlare(flareLog());
    if (f) mount(host, activeCard(f), guidanceCard(), historyCard());
    else mount(host, startCard(), historyCard() || guidanceCard());
  }
  render();
  const unsub = store.subscribe(KEY, render);
  return unsub;
}

export function getSummary() {
  const f = activeFlare(flareLog());
  return { active: !!f, days: f ? activeFlareDays(flareLog(), todayKey()) : 0 };
}
