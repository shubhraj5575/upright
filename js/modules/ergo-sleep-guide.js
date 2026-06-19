// ergo-sleep-guide.js — ergonomics & sleep guidance loaded from /data, plus a
// persisted daily ergonomic-habits checklist. Content is fetched (async) so the
// view renders a brief loading line first. Module contract: exports init(mountEl)
// and getSummary().

import * as store from '../core/store.js';
import { el, mount, clear, card } from '../core/ui.js';

const KEY = 'ergoChecklist';
const CONTENT_URL = 'data/ergo-sleep-content.json';

// Cached at module scope so getSummary() has the checklist length even when the
// view isn't mounted. Empty until the JSON has been fetched at least once.
let checklist = [];

function checkedState() {
  return store.get(KEY, {}) || {};
}

function isChecked(id) {
  return !!checkedState()[id];
}

/** Toggle one habit, writing only that id into the persisted object. */
function setChecked(id, on) {
  store.update(KEY, (cur) => {
    const next = { ...(cur || {}) };
    if (on) next[id] = true;
    else delete next[id];
    return next;
  });
}

function countChecked() {
  const state = checkedState();
  return checklist.filter((item) => state[item.id]).length;
}

function sectionCard(section) {
  return card(null,
    el('div', { class: 'row', style: { gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-3)' } },
      el('span', { 'aria-hidden': 'true', style: { fontSize: 'var(--text-2xl)' } }, section.icon),
      el('h2', { class: 'card__title', style: { marginBottom: 0 } }, section.title)
    ),
    el('div', { 'aria-hidden': 'true', style: { float: 'right', margin: '0 0 var(--space-2) var(--space-4)' }, html: section.svg }),
    el('ul', { class: 'stack', style: { paddingLeft: 'var(--space-5)', margin: 0 } },
      section.tips.map((tip) => el('li', { style: { marginBottom: 'var(--space-2)' } }, tip))
    )
  );
}

export function init(mountEl) {
  let alive = true; // guards against navigate-away during the async fetch
  let unsub = null;

  const host = el('div', { class: 'stack' });
  const loading = el('p', { class: 'text-muted' }, 'Loading guidance…');

  mount(mountEl,
    el('div', { class: 'view-header' },
      el('h1', {}, 'Ergonomics & sleep'),
      el('p', {}, 'Simple, practical ways to protect your lower back through the day and night.')
    ),
    host
  );
  mount(host, loading);

  fetch(CONTENT_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((content) => {
      if (!alive) return; // navigated away mid-fetch — do nothing
      checklist = (content && content.checklist) || [];
      const sections = (content && content.sections) || [];

      // --- checklist card: re-render its inner body on every change so toggles
      // don't rebuild the SVG sections above it. ---------------------------
      const progress = el('span', { class: 'badge badge--primary' });
      const listBody = el('div', { class: 'stack' });

      function renderChecklist() {
        const total = checklist.length;
        const checked = countChecked();
        progress.textContent = `${checked} / ${total} done`;

        clear(listBody);
        mount(listBody, ...checklist.map((item) => {
          const box = el('input', {
            type: 'checkbox',
            id: `ergo-${item.id}`,
            checked: isChecked(item.id),
            onChange: (e) => setChecked(item.id, e.target.checked),
            style: { width: '18px', height: '18px', flex: 'none', accentColor: 'var(--color-primary)', cursor: 'pointer' },
          });
          return el('label', {
            for: `ergo-${item.id}`,
            class: 'row',
            style: { gap: 'var(--space-3)', alignItems: 'center', cursor: 'pointer', padding: 'var(--space-1) 0' },
          }, box, el('span', {}, item.text));
        }));
      }

      const checklistCard = card('Daily checklist',
        el('div', { class: 'row row--between', style: { marginBottom: 'var(--space-3)' } },
          el('span', { class: 'card__subtitle', style: { margin: 0 } }, 'Tick off the habits you managed today.'),
          progress
        ),
        listBody
      );

      const disclaimer = el('p', { class: 'field__hint', style: { textAlign: 'center', marginTop: 'var(--space-4)' } },
        'This is general guidance, not a substitute for advice from your physiotherapist.'
      );

      clear(host);
      mount(host, ...sections.map(sectionCard), checklistCard, disclaimer);
      renderChecklist();

      // Keep the checklist + progress in sync with the store (e.g. import,
      // another tab). Set up only after content has loaded.
      unsub = store.subscribe(KEY, renderChecklist);
    })
    .catch(() => {
      if (!alive) return;
      clear(host);
      mount(host, el('div', { class: 'callout callout--warn' },
        el('div', { class: 'callout__title' }, 'Couldn’t load the guidance'),
        el('span', {}, 'Please check your connection and try again — your data is safe.')
      ));
    });

  // Teardown returned synchronously; the guard handles a fetch still in flight.
  return () => {
    alive = false;
    if (unsub) unsub();
  };
}

export function getSummary() {
  return { checked: countChecked(), total: checklist.length };
}
