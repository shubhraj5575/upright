// meal-log.js — USDA-backed nutrition tracker: search (local + online), a
// portion chooser, per-entry nutrient snapshots, a daily rollup with a micros
// table, and a 7-day kcal/protein trend. Rewritten from the original tag-only
// quick-log (Nutrition Task 4); preserves delete-by-timestamp + Undo-toast and
// still renders LEGACY entries (old shape `{name, tags, t}`, no meal/nutrients).
// Module contract: exports init(mountEl) → teardown, and getSummary().
//
// Rendering is split into a STABLE region (search box, results, portion
// chooser, custom-food button — built once in init) and a REACTIVE region
// (Today / rollup / week — rebuilt by renderData() on every `mealLog`
// change). Only `mealLog` is subscribed: foodCache is written during pick/
// custom-add but nothing on screen needs to react to that write mid-flow, so
// a foodCache subscription would just risk tearing down an open search or
// portion chooser under the user's fingers.

import * as store from '../core/store.js';
import { todayKey, addDays, parseKey } from '../core/dates.js';
import { el, mount, clear, card, toast, pageHeader, emptyState, setFieldError, openDialog, segmented } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { lineChart, progressRing } from '../core/charts.js';
import {
  NUTRIENT_KEYS, normalizeUsdaFood, scaleNutrients, dailyTotals, targetStatus,
  searchFoods,
} from '../core/nutrition.js';

const KEY = 'mealLog';
const CACHE_KEY = 'foodCache';
const SEED_URL = 'data/foods-starter.json';
const SEARCH_DEBOUNCE_MS = 250;

const MEALS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
];

// Quick tag chips — kept as an optional secondary affordance in the portion
// chooser (also the canonical order used when tallying legacy meals' tags).
const TAGS = ['anti-inflammatory', 'high-protein', 'calcium', 'vit-d', 'omega-3', 'fiber'];

// Display metadata for the 13 canonical nutrient keys: label + unit + rounding.
const NUTRIENT_META = {
  kcal: { label: 'Calories', unit: 'kcal', round: 0 },
  protein_g: { label: 'Protein', unit: 'g', round: 1 },
  carb_g: { label: 'Carbs', unit: 'g', round: 1 },
  fat_g: { label: 'Fat', unit: 'g', round: 1 },
  fiber_g: { label: 'Fiber', unit: 'g', round: 1 },
  sugar_g: { label: 'Sugar', unit: 'g', round: 1 },
  sodium_mg: { label: 'Sodium', unit: 'mg', round: 0 },
  calcium_mg: { label: 'Calcium', unit: 'mg', round: 0 },
  vitD_ug: { label: 'Vitamin D', unit: 'µg', round: 1 },
  magnesium_mg: { label: 'Magnesium', unit: 'mg', round: 0 },
  potassium_mg: { label: 'Potassium', unit: 'mg', round: 0 },
  iron_mg: { label: 'Iron', unit: 'mg', round: 1 },
  omega3_g: { label: 'Omega-3', unit: 'g', round: 2 },
};

function round(v, places = 0) {
  const f = Math.pow(10, places);
  return Math.round((v || 0) * f) / f;
}

function fmtAmount(key, amount) {
  const meta = NUTRIENT_META[key] || { unit: '', round: 1 };
  return `${round(amount, meta.round)} ${meta.unit}`.trim();
}

function log() {
  return store.get(KEY) || {};
}

function todayEntries() {
  return log()[todayKey()] || [];
}

function nutritionSettings() {
  const s = store.get('settings') || {};
  const n = s.nutrition || {};
  const defaultTargets = {
    kcal: 2000, protein_g: 60, carb_g: 250, fat_g: 70, fiber_g: 30,
    sugar_g: 50, sodium_mg: 2300, calcium_mg: 1000, vitD_ug: 15,
    magnesium_mg: 400, potassium_mg: 3500, iron_mg: 12, omega3_g: 1.6,
  };
  return {
    usdaApiKey: n.usdaApiKey || '',
    onlineLookup: n.onlineLookup !== false,
    targets: { ...defaultTargets, ...(n.targets || {}) },
  };
}

function foodCache() {
  return store.get(CACHE_KEY) || {};
}

function slug(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'food';
}

function defaultMealForHour(hour = new Date().getHours()) {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  if (hour < 21) return 'dinner';
  return 'snack';
}

// --- entry mutation ----------------------------------------------------------

function addEntry(entry) {
  const k = todayKey();
  store.update(KEY, (all) => {
    const day = all[k] ? all[k].slice() : [];
    day.push(entry);
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

/** Re-insert a just-deleted entry (Undo), keeping time order by timestamp. */
function restoreMeal(entry) {
  const k = todayKey();
  store.update(KEY, (all) => {
    const day = (all[k] || []).slice();
    if (!day.some((e) => e.t === entry.t)) {
      day.push(entry);
      day.sort((a, b) => (a.t < b.t ? -1 : 1));
    }
    return { ...all, [k]: day };
  });
}

function timeLabel(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function isLegacy(entry) {
  return !entry.meal && !entry.nutrients;
}

async function loadSeed() {
  const res = await fetch(SEED_URL);
  if (!res.ok) throw new Error(`seed fetch failed: ${res.status}`);
  return res.json();
}

export function init(mountEl) {
  let torn = false;
  let unsubs = [];
  let localPool = []; // starter seed, loaded once (best-effort)
  let searchTimer = null;
  let searchSeq = 0; // monotonic guard against out-of-order async resolution

  mount(mountEl,
    pageHeader({
      title: 'Food',
      sub: 'Search a food, log a portion, and see your day and week at a glance.',
      actions: [el('a', { class: 'btn btn--ghost btn--sm', href: '#/meal-plan' }, icon('calendar', { size: 15 }), 'Meal plan')],
    })
  );

  // ---------------------------------------------------------------------
  // STABLE region: search box, results, portion chooser, custom-food entry.
  // Built once; never torn down by a mealLog change.
  // ---------------------------------------------------------------------

  const searchInput = el('input', {
    class: 'input', type: 'text', placeholder: 'Search a food… e.g. chicken breast',
    'aria-label': 'Search foods',
  });
  const resultsHost = el('div', { class: 'stack', style: { marginTop: 'var(--space-3)' } });
  const chooserHost = el('div', {}); // portion chooser panel mounts here

  function currentPool() {
    return [...localPool, ...Object.values(foodCache())];
  }

  function localMatches(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return currentPool()
      .filter((f) => (f.name && f.name.toLowerCase().includes(q)) || (f.brand && f.brand.toLowerCase().includes(q)))
      .slice(0, 8);
  }

  function renderResults(local, online, note) {
    clear(resultsHost);
    const rows = [];
    for (const f of local) rows.push(resultRow(f));
    for (const f of online) rows.push(resultRow(f));
    if (note) resultsHost.appendChild(el('p', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } }, note));
    if (!rows.length && searchInput.value.trim()) {
      resultsHost.appendChild(el('p', { class: 'text-faint', style: { fontSize: 'var(--text-sm)' } }, 'No matches yet.'));
      return;
    }
    mount(resultsHost, ...rows);
  }

  function sourceHint(source) {
    if (source === 'usda') return 'USDA';
    if (source === 'custom') return 'custom';
    if (source === 'seed') return 'saved';
    return source || 'saved';
  }

  // `food` is always a canonical record here ({id, source, name, brand?,
  // servings, per100g}) — online USDA results are normalized before this is
  // ever called, so this needs no per-kind branching.
  function resultRow(food) {
    const kcal = food.per100g ? round(food.per100g.kcal, 0) : 0;
    return el('button', {
      class: 'btn btn--ghost', style: {
        width: '100%', justifyContent: 'flex-start', textAlign: 'left', display: 'flex',
        gap: 'var(--space-2)', alignItems: 'center', padding: 'var(--space-2) var(--space-3)',
      },
      onClick: () => openPortionChooser(food),
    },
      el('span', { class: 'badge badge--accent', style: { flex: '0 0 auto' } }, sourceHint(food.source)),
      el('span', { style: { flex: '1 1 auto', minWidth: 0 } },
        el('div', {}, food.name),
        food.brand ? el('div', { class: 'text-faint', style: { fontSize: 'var(--text-xs)' } }, food.brand) : null),
      el('span', { class: 'text-muted', style: { flex: '0 0 auto', fontSize: 'var(--text-sm)' } }, `${kcal} kcal/100g`));
  }

  function runSearch(query) {
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    const q = query.trim();
    if (!q) { clear(resultsHost); return; }
    searchTimer = setTimeout(() => doSearch(q), SEARCH_DEBOUNCE_MS);
  }

  async function doSearch(query) {
    const mySeq = ++searchSeq;
    const local = localMatches(query);
    renderResults(local, [], null);

    const settings = nutritionSettings();
    if (!(settings.onlineLookup && query.length >= 2)) return;

    try {
      const raw = await searchFoods(query, settings.usdaApiKey);
      if (torn || mySeq !== searchSeq) return; // stale or torn down
      if (searchInput.value.trim() !== query) return; // input moved on
      // Normalize to our canonical shape up front so result rows and the
      // portion chooser need no per-source branching. Drop any USDA hit that
      // duplicates a food already shown from the local pool (e.g. a food the
      // user already picked once and cached).
      const localIds = new Set(local.map((f) => f.id));
      const online = (raw || [])
        .map((f) => normalizeUsdaFood(f))
        .filter((f) => !localIds.has(f.id));
      renderResults(local, online, null);
    } catch (err) {
      if (torn || mySeq !== searchSeq) return;
      if (searchInput.value.trim() !== query) return;
      if (err && err.status === 429) {
        toast('USDA search is rate-limited right now — showing local foods. Add your free API key in Settings for reliable search.', { type: 'warn' });
      } else {
        toast('Couldn’t reach USDA — showing local foods.', { type: 'info' });
      }
      renderResults(local, [], 'Showing local foods only.');
    }
  }

  searchInput.addEventListener('input', () => runSearch(searchInput.value));

  const privacyNote = el('p', { class: 'text-faint', style: { fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' } },
    'Food search uses USDA’s online database — only your search words are sent. Your logs never leave this device.');

  function refreshPrivacyNote() {
    const settings = nutritionSettings();
    if (!settings.onlineLookup) {
      privacyNote.textContent = 'Online lookup is off in Settings — search uses your local and saved foods only.';
    } else if (!settings.usdaApiKey) {
      privacyNote.textContent = 'Food search uses USDA’s online database (a shared trial key — add your own free key in Settings for reliable results). Only your search words are sent; your logs never leave this device.';
    } else {
      privacyNote.textContent = 'Food search uses USDA’s online database — only your search words are sent. Your logs never leave this device.';
    }
  }
  refreshPrivacyNote();

  const customFoodBtn = el('button', { class: 'btn btn--ghost btn--sm', onClick: () => openCustomFoodDialog() },
    icon('plus', { size: 14 }), 'Add a custom food');

  const searchCard = card('Log a food',
    el('div', { class: 'field' }, searchInput),
    privacyNote,
    resultsHost,
    chooserHost,
    el('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: 'var(--space-3)' } }, customFoodBtn));

  // --- portion chooser -------------------------------------------------------

  function openPortionChooser(food) {
    clear(chooserHost);

    // `food` arrives already normalized to the canonical shape (results are
    // normalized at search time — see doSearch). A fresh USDA pick just needs
    // stamping + writing into foodCache on first use; a repeat pick, or any
    // local/seed/custom record, is used as-is.
    let record = food;
    if (food.source === 'usda' && !foodCache()[food.id]) {
      record = { ...food, fetchedAt: new Date().toISOString() };
      store.update(CACHE_KEY, (c) => ({ ...c, [record.id]: record }));
    }

    const servings = record.servings && record.servings.length ? record.servings : [{ label: '100 g', grams: 100 }];
    const CUSTOM_VALUE = '__custom_grams__';
    const servingSelect = el('select', { class: 'input' },
      ...servings.map((s, i) => el('option', { value: String(i) }, `${s.label} (${s.grams} g)`)),
      el('option', { value: CUSTOM_VALUE }, 'Custom amount (grams)'));
    const gramsInput = el('input', { class: 'input', type: 'number', min: '0', step: '1', value: String(servings[0].grams), style: { display: 'none' } });

    const mealSeg = segmented({
      options: MEALS, value: defaultMealForHour(), ariaLabel: 'Meal',
      onChange: () => {},
    });

    const previewKcal = el('strong', {}, '0');
    const previewMacros = el('span', { class: 'text-muted' }, '');
    const preview = el('div', { class: 'row', style: { gap: 'var(--space-3)', alignItems: 'baseline', marginTop: 'var(--space-2)' } },
      previewKcal, el('span', {}, 'kcal'), previewMacros);

    const tagBoxes = TAGS.map((tag) =>
      el('label', { class: 'tag', style: { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' } },
        el('input', { type: 'checkbox', value: tag }),
        tag));

    function currentGrams() {
      if (servingSelect.value === CUSTOM_VALUE) return Math.max(0, Number(gramsInput.value) || 0);
      const s = servings[Number(servingSelect.value)];
      return s ? s.grams : 0;
    }

    function updatePreview() {
      const grams = currentGrams();
      const n = scaleNutrients(record.per100g, grams);
      previewKcal.textContent = String(round(n.kcal, 0));
      previewMacros.textContent = `· protein ${round(n.protein_g, 1)}g · carbs ${round(n.carb_g, 1)}g · fat ${round(n.fat_g, 1)}g`;
    }

    servingSelect.addEventListener('change', () => {
      gramsInput.style.display = servingSelect.value === CUSTOM_VALUE ? '' : 'none';
      updatePreview();
    });
    gramsInput.addEventListener('input', updatePreview);
    updatePreview();

    function addAndClose() {
      const grams = currentGrams();
      if (!(grams > 0)) {
        toast('Enter a portion amount above 0.', { type: 'warn' });
        return;
      }
      const nutrients = scaleNutrients(record.per100g, grams);
      const isCustomAmount = servingSelect.value === CUSTOM_VALUE;
      const servingLabel = isCustomAmount ? null : servings[Number(servingSelect.value)].label;
      const tags = tagBoxes.filter((lbl) => lbl.querySelector('input').checked).map((lbl) => lbl.querySelector('input').value);

      addEntry({
        foodId: record.id,
        name: record.name,
        qty: isCustomAmount ? grams : 1,
        unit: isCustomAmount ? 'g' : servingLabel,
        grams,
        meal: mealSeg.get(),
        nutrients,
        tags: tags.length ? tags : undefined,
        t: new Date().toISOString(),
      });

      toast(`Logged “${record.name}”.`, { type: 'success' });
      clear(chooserHost);
      clear(resultsHost);
      searchInput.value = '';
    }

    const addBtn = el('button', { class: 'btn btn--primary', onClick: addAndClose }, icon('plus', { size: 16 }), 'Add');
    const cancelBtn = el('button', { class: 'btn btn--ghost', onClick: () => clear(chooserHost) }, 'Cancel');

    chooserHost.appendChild(card(`Log: ${record.name}`,
      el('div', { class: 'field' }, el('label', {}, 'Portion'), servingSelect),
      el('div', { class: 'field' }, el('label', {}, 'Custom grams'), gramsInput),
      el('div', { class: 'field' }, el('label', {}, 'Meal'), mealSeg.root),
      preview,
      el('div', { class: 'field' },
        el('label', {}, 'Tags (optional)'),
        el('div', { class: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-2)' } }, ...tagBoxes)),
      el('div', { class: 'row', style: { justifyContent: 'flex-end', gap: 'var(--space-2)' } }, cancelBtn, addBtn)));
    chooserHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // --- custom food dialog -----------------------------------------------------

  function openCustomFoodDialog() {
    const nameInput = el('input', { class: 'input', placeholder: 'Food name' });
    const nameField = el('div', { class: 'field', style: { marginBottom: 0 } }, el('label', {}, 'Name'), nameInput);

    function macroField(key) {
      const meta = NUTRIENT_META[key];
      const input = el('input', { class: 'input', type: 'number', min: '0', step: 'any', value: '0' });
      const field = el('div', { class: 'field', style: { marginBottom: 0 } },
        el('label', {}, `${meta.label} (${meta.unit} per 100 g)`), input);
      return { key, input, field };
    }

    const prominent = ['kcal', 'protein_g', 'carb_g', 'fat_g'].map(macroField);
    const micros = NUTRIENT_KEYS.filter((k) => !prominent.some((p) => p.key === k)).map(macroField);

    const microDetails = el('details', { style: { marginTop: 'var(--space-4)' } },
      el('summary', {}, 'More nutrients (optional, default 0)'),
      el('div', { class: 'grid', style: { marginTop: 'var(--space-3)' } }, ...micros.map((m) => m.field)));

    function onSave() {
      const name = nameInput.value.trim();
      if (!name) { setFieldError(nameField, 'Give the food a name.'); return false; }
      setFieldError(nameField, null);
      const per100g = {};
      for (const m of [...prominent, ...micros]) {
        const v = Number(m.input.value);
        per100g[m.key] = Number.isFinite(v) && v >= 0 ? v : 0;
      }
      const rec = {
        id: 'custom:' + slug(name) + '-' + Date.now(),
        source: 'custom',
        name,
        servings: [{ label: '100 g', grams: 100 }],
        per100g,
      };
      store.update(CACHE_KEY, (c) => ({ ...c, [rec.id]: rec }));
      toast('Custom food saved — search for it to log a portion.', { type: 'success' });
      return true;
    }

    const saveBtn = el('button', { class: 'btn btn--primary', onClick: () => { if (onSave()) handle.close(); } }, 'Save food');
    const cancelBtn = el('button', { class: 'btn btn--ghost', onClick: () => handle.close() }, 'Cancel');
    const handle = openDialog({
      title: 'Add a custom food',
      content: el('div', {},
        nameField,
        el('div', { class: 'grid', style: { marginTop: 'var(--space-3)' } }, ...prominent.map((m) => m.field)),
        microDetails),
      actions: [cancelBtn, saveBtn],
    });
    nameInput.focus();
  }

  // ---------------------------------------------------------------------
  // REACTIVE region: Today (grouped by meal) + rollup + week. Rebuilt on
  // every mealLog change.
  // ---------------------------------------------------------------------

  const dataHost = el('div', { class: 'stack' });
  mount(mountEl, searchCard, dataHost);

  function entryRow(e) {
    const portion = e.grams != null
      ? (e.unit && e.unit !== 'g' ? `${e.qty} × ${e.unit}` : `${round(e.grams, 0)} g`)
      : null;
    const kcalText = e.nutrients ? `${round(e.nutrients.kcal, 0)} kcal` : null;
    return el('div', { class: 'row row--between', style: { alignItems: 'flex-start', gap: 'var(--space-3)' } },
      el('div', { class: 'stack', style: { gap: 'var(--space-1)' } },
        el('strong', {}, e.name),
        el('div', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } },
          [portion, kcalText].filter(Boolean).join(' · ')),
        (e.tags && e.tags.length)
          ? el('div', { class: 'row', style: { flexWrap: 'wrap', gap: 'var(--space-1)' } },
              ...e.tags.map((t) => el('span', { class: 'tag' }, t)))
          : null,
        el('div', { class: 'text-faint', style: { fontSize: 'var(--text-xs)' } }, timeLabel(e.t))),
      el('button', {
        class: 'btn btn--ghost btn--sm', style: { minWidth: '44px', minHeight: '44px' },
        'aria-label': `Delete ${e.name}`,
        onClick: () => {
          deleteMeal(e);
          toast(`Removed “${e.name}”.`, { type: 'info', action: { label: 'Undo', onClick: () => restoreMeal(e) } });
        },
      }, icon('trash', { size: 16 })));
  }

  function todayCard() {
    const entries = todayEntries();
    if (!entries.length) {
      return card('Today', emptyState({
        icon: 'utensils',
        title: 'No food logged today',
        body: 'Search above to log your first food — it only takes a second.',
      }));
    }

    const groups = { breakfast: [], lunch: [], dinner: [], snack: [], other: [] };
    for (const e of entries) {
      if (isLegacy(e)) groups.other.push(e);
      else (groups[e.meal] || groups.other).push(e);
    }

    const sections = [];
    for (const m of [...MEALS, { value: 'other', label: 'Other' }]) {
      const list = groups[m.value];
      if (!list.length) continue;
      const subtotal = list.reduce((sum, e) => sum + ((e.nutrients && e.nutrients.kcal) || 0), 0);
      sections.push(el('div', { class: 'stack', style: { gap: 'var(--space-2)', marginBottom: 'var(--space-4)' } },
        el('div', { class: 'row row--between' },
          el('h3', { style: { margin: 0, fontSize: 'var(--text-sm)', textTransform: 'uppercase', color: 'var(--color-text-muted)' } }, m.label),
          subtotal ? el('span', { class: 'text-muted', style: { fontSize: 'var(--text-sm)' } }, `${round(subtotal, 0)} kcal`) : null),
        ...list.slice().reverse().map(entryRow)));
    }

    return card('Today', el('div', { class: 'stack' }, ...sections));
  }

  function rollupCard() {
    const settings = nutritionSettings();
    const totals = dailyTotals(todayEntries());
    const targets = settings.targets;

    const ring = progressRing({
      value: totals.kcal, max: targets.kcal || 1, size: 132, stroke: 12,
      color: 'var(--color-primary)', label: 'Calories',
      center: String(round(totals.kcal, 0)), sub: 'kcal',
    });

    const macroKeys = ['protein_g', 'carb_g', 'fat_g'];
    const macroBars = macroKeys.map((key) => {
      const meta = NUTRIENT_META[key];
      const target = targets[key] || 0;
      const amount = totals[key] || 0;
      const pct = target > 0 ? Math.min(100, Math.round((amount / target) * 100)) : 0;
      return el('div', { class: 'stack', style: { gap: 'var(--space-1)' } },
        el('div', { class: 'row row--between' },
          el('span', {}, meta.label),
          el('span', { class: 'text-muted' }, `${round(amount, 1)}${meta.unit} / ${target}${meta.unit} (${pct}%)`)),
        el('div', { style: { height: '8px', borderRadius: '999px', background: 'var(--color-surface-2)', overflow: 'hidden' } },
          el('div', { style: { height: '100%', width: `${pct}%`, background: 'var(--color-primary)', borderRadius: '999px' } })));
    });

    const rows = targetStatus(totals, targets);
    const table = el('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' } },
      el('thead', {},
        el('tr', {},
          el('th', { style: { textAlign: 'left', padding: 'var(--space-1) var(--space-2)' } }, 'Nutrient'),
          el('th', { style: { textAlign: 'right', padding: 'var(--space-1) var(--space-2)' } }, 'Amount'),
          el('th', { style: { textAlign: 'right', padding: 'var(--space-1) var(--space-2)' } }, '% target'))),
      el('tbody', {},
        ...rows.map((r) => {
          const meta = NUTRIENT_META[r.key] || { label: r.key, unit: '' };
          const pct = Math.round(r.pct);
          return el('tr', { style: { borderTop: '1px solid var(--color-border)' } },
            el('td', { style: { padding: 'var(--space-1) var(--space-2)' } }, meta.label),
            el('td', { style: { textAlign: 'right', padding: 'var(--space-1) var(--space-2)' } }, fmtAmount(r.key, r.amount)),
            el('td', { style: { textAlign: 'right', padding: 'var(--space-1) var(--space-2)', color: pct >= 100 ? 'var(--color-primary)' : 'var(--color-text-muted)' } }, `${pct}%`));
        })));

    return card('Today’s rollup',
      el('div', { class: 'row', style: { gap: 'var(--space-5)', alignItems: 'center', flexWrap: 'wrap' } },
        ring,
        el('div', { class: 'stack', style: { gap: 'var(--space-3)', flex: '1 1 220px', minWidth: '220px' } }, ...macroBars)),
      el('h3', { style: { marginTop: 'var(--space-5)', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', textTransform: 'uppercase', color: 'var(--color-text-muted)' } }, 'All nutrients'),
      table);
  }

  function weekCard() {
    const keys = [];
    for (let i = 6; i >= 0; i--) keys.push(addDays(todayKey(), -i));
    const labels = keys.map((k) => parseKey(k).toLocaleDateString(undefined, { weekday: 'narrow' }));
    const dayTotals = keys.map((k) => dailyTotals(log()[k] || []));
    const kcalValues = dayTotals.map((t) => round(t.kcal, 0));
    const proteinValues = dayTotals.map((t) => round(t.protein_g, 1));

    return card('This week',
      el('p', { class: 'card__subtitle' }, 'Calories'),
      lineChart({
        series: [{ values: kcalValues, color: 'var(--color-primary)', label: 'kcal', fill: true }],
        labels, yMin: 0, yMax: Math.max(...kcalValues, nutritionSettings().targets.kcal || 0, 1) * 1.1,
        height: 140, ariaLabel: 'Calories logged over the last 7 days', interactive: true,
        tipFormat: (v) => `${v} kcal`,
      }),
      el('p', { class: 'card__subtitle', style: { marginTop: 'var(--space-4)' } }, 'Protein'),
      lineChart({
        series: [{ values: proteinValues, color: 'var(--color-accent)', label: 'protein', fill: true }],
        labels, yMin: 0, yMax: Math.max(...proteinValues, nutritionSettings().targets.protein_g || 0, 1) * 1.1,
        height: 120, ariaLabel: 'Protein logged over the last 7 days', interactive: true,
        tipFormat: (v) => `${v} g`,
      }));
  }

  function renderData() {
    clear(dataHost);
    mount(dataHost, todayCard(), rollupCard(), weekCard());
  }

  // --- async seed-then-build --------------------------------------------------
  (async () => {
    try {
      localPool = await loadSeed();
    } catch (_) {
      localPool = []; // offline/first-load failure — still fully usable via foodCache
    }
    if (torn) return;
    renderData();
    unsubs.push(store.subscribe(KEY, renderData));
  })();

  return () => {
    torn = true;
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    searchSeq += 1; // invalidate any in-flight search resolution
    unsubs.forEach((u) => u());
    unsubs = [];
  };
}

export function getSummary() {
  const entries = store.get(KEY)[todayKey()] || [];
  const totals = dailyTotals(entries);
  const settings = nutritionSettings();
  const kcalTarget = settings.targets.kcal || 0;
  const proteinTarget = settings.targets.protein_g || 0;
  return {
    countToday: entries.length,
    logged: entries.length > 0,
    kcal: round(totals.kcal, 0),
    kcalTarget,
    proteinPct: proteinTarget > 0 ? Math.round((totals.protein_g / proteinTarget) * 100) : 0,
  };
}
