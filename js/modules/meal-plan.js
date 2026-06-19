// meal-plan.js — a customizable, anti-inflammatory weekly meal plan to support
// recovery. Seeds from /data on first use, then lives in the store so per-meal
// edits persist. Module contract: exports init(mountEl) and getSummary().

import * as store from '../core/store.js';
import { el, mount, clear, card, toast } from '../core/ui.js';

const KEY = 'mealPlan';
const STARTER_URL = 'data/meal-plan-starter.json';

const SLOTS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
];

// Fallback labels if a meal carries a tag id the legend doesn't name.
const TAG_IDS = ['anti-inflammatory', 'high-protein', 'calcium', 'vit-d', 'omega-3', 'fiber'];

function plan() {
  return store.get(KEY) || {};
}

/** True once a real weekly grid has been seeded into the store. */
function hasDays(p) {
  return !!(p && Array.isArray(p.days) && p.days.length);
}

/** Build a label lookup from the stored legend, for tag chips. */
function tagLabels(p) {
  const map = {};
  (p.tagLegend || []).forEach((t) => { map[t.id] = t.label; });
  return map;
}

export function init(mountEl) {
  let disposed = false; // guards async render after navigate-away
  let highlight = null; // currently toggled legend tag id, or null

  const host = el('div', { class: 'stack' });
  mount(mountEl,
    el('div', { class: 'view-header' },
      el('h1', {}, 'Meal plan'),
      el('p', {}, 'A customizable, anti-inflammatory week built around recovery foods — oily fish, leafy greens, berries and whole grains. Tweak any meal to suit you.')
    ),
    host
  );

  // --- legend -------------------------------------------------------------
  function legendRow(p) {
    const labels = tagLabels(p);
    return card('Nutrition focus',
      el('p', { class: 'card__subtitle' }, 'Tap a focus to highlight the meals that support it.'),
      el('div', { class: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-2)' } },
        ...(p.tagLegend || []).map((t) => {
          const on = highlight === t.id;
          return el('button', {
            class: 'badge' + (on ? ' badge--primary' : ''),
            style: { cursor: 'pointer', border: on ? '1px solid var(--color-primary)' : '1px solid transparent' },
            'aria-pressed': on ? 'true' : 'false',
            onClick: () => { highlight = on ? null : t.id; render(); },
          }, labels[t.id] || t.id);
        })
      )
    );
  }

  // --- one meal slot (view or inline editor) ------------------------------
  function mealSlot(p, dayIndex, slot) {
    const meal = ((p.days[dayIndex] || {}).meals || {})[slot.id] || { name: '', tags: [] };
    const dimmed = highlight && !meal.tags.includes(highlight);
    const ringed = highlight && meal.tags.includes(highlight);

    const slotHost = el('div', {
      style: {
        padding: 'var(--space-3)',
        border: ringed ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        opacity: dimmed ? '0.4' : '1',
        transition: 'opacity var(--transition-fast)',
      },
    });

    function renderView() {
      clear(slotHost);
      mount(slotHost,
        el('div', { class: 'row row--between', style: { alignItems: 'baseline' } },
          el('span', { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' } }, slot.label),
          el('button', { class: 'btn btn--sm btn--ghost', onClick: renderEditor }, 'Edit')
        ),
        el('div', { style: { marginTop: 'var(--space-1)', fontWeight: 'var(--weight-medium)' } }, meal.name || '—'),
        meal.tags.length
          ? el('div', { class: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-1)', marginTop: 'var(--space-2)' } },
            ...meal.tags.map((id) => el('span', { class: 'tag' }, (tagLabels(p)[id] || id))))
          : null
      );
    }

    function renderEditor() {
      clear(slotHost);
      const nameInput = el('input', { class: 'input', type: 'text', value: meal.name, placeholder: `${slot.label} name` });
      const tagOrder = (p.tagLegend && p.tagLegend.length) ? p.tagLegend.map((t) => t.id) : TAG_IDS;
      const labels = tagLabels(p);
      const checks = tagOrder.map((id) => {
        const input = el('input', { type: 'checkbox', value: id });
        input.checked = meal.tags.includes(id);
        return { id, input, label: el('label', { class: 'row', style: { gap: 'var(--space-2)', fontSize: 'var(--text-sm)' } }, input, (labels[id] || id)) };
      });

      function save() {
        const name = nameInput.value.trim();
        const tags = checks.filter((c) => c.input.checked).map((c) => c.id);
        store.update(KEY, (cur) => {
          const next = { ...cur, days: (cur.days || []).map((d) => ({ ...d, meals: { ...d.meals } })) };
          next.days[dayIndex].meals[slot.id] = { name, tags };
          return next;
        });
        toast(`${slot.label} updated.`, { type: 'success', duration: 1800 });
        // store subscription triggers a full re-render.
      }

      mount(slotHost,
        el('div', { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-2)' } }, `Edit ${slot.label}`),
        el('div', { class: 'field', style: { marginBottom: 'var(--space-3)' } }, nameInput),
        el('div', { class: 'radio-row', style: { marginBottom: 'var(--space-3)' } }, ...checks.map((c) => c.label)),
        el('div', { class: 'row', style: { gap: 'var(--space-2)' } },
          el('button', { class: 'btn btn--primary btn--sm', onClick: save }, 'Save'),
          el('button', { class: 'btn btn--ghost btn--sm', onClick: renderView }, 'Cancel')
        )
      );
    }

    renderView();
    return slotHost;
  }

  // --- one day card -------------------------------------------------------
  function dayCard(p, dayIndex) {
    const day = p.days[dayIndex];
    return card(day.day,
      el('div', { class: 'stack', style: { gap: 'var(--space-3)' } },
        ...SLOTS.map((slot) => mealSlot(p, dayIndex, slot))
      )
    );
  }

  // --- reset (guarded inline confirm) -------------------------------------
  function resetRow() {
    const wrap = el('div', { class: 'row', style: { justifyContent: 'flex-end' } });
    function ask() {
      clear(wrap);
      mount(wrap,
        el('span', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } }, 'Replace your plan with the starter week?'),
        el('button', { class: 'btn btn--danger btn--sm', onClick: () => { seed(true); } }, 'Reset'),
        el('button', { class: 'btn btn--ghost btn--sm', onClick: idle }, 'Cancel')
      );
    }
    function idle() {
      clear(wrap);
      mount(wrap, el('button', { class: 'btn btn--ghost btn--sm', onClick: ask }, 'Reset to starter plan'));
    }
    idle();
    return wrap;
  }

  // --- render -------------------------------------------------------------
  function render() {
    if (disposed) return;
    const p = plan();
    clear(host);
    if (!hasDays(p)) {
      mount(host, el('p', { class: 'text-muted' }, 'Loading your meal plan…'));
      return;
    }
    const grid = el('div', {
      class: 'grid',
      style: { gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-4)' },
    }, ...p.days.map((_, i) => dayCard(p, i)));

    mount(host, legendRow(p), grid, resetRow());
  }

  // --- seeding ------------------------------------------------------------
  async function seed(force) {
    if (disposed) return;
    if (!force && hasDays(plan())) { render(); return; }
    render(); // shows the loading line
    try {
      const res = await fetch(STARTER_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (disposed) return;
      store.set(KEY, data); // subscription re-renders
      if (force) toast('Reset to the starter meal plan.', { type: 'success' });
    } catch (err) {
      if (disposed) return;
      // eslint-disable-next-line no-console
      console.error('[meal-plan] failed to load starter plan:', err);
      clear(host);
      mount(host, el('div', { class: 'callout callout--warn' },
        el('div', { class: 'callout__title' }, 'Couldn’t load the starter plan'),
        el('p', {}, 'Check your connection and try again.')
      ));
    }
  }

  // First paint: use the stored plan, or fetch + seed the starter week.
  if (hasDays(plan())) render(); else seed(false);

  const unsub = store.subscribe(KEY, render);
  return () => { disposed = true; unsub(); };
}

export function getSummary() {
  return { hasPlan: hasDays(plan()) };
}
