// Shape/typo guard for data/foods-starter.json — the offline food seed used so
// search + logging work with no network and no API key. This is NOT an
// accuracy check (macro/micro correctness is reviewed by hand at authoring
// time); it only catches structural mistakes and gross typos (e.g. a
// decimal-place slip in kcal). Runs in Node and tests/index.html.

import { createSuite, reportToConsole } from './harness.js';
import { NUTRIENT_KEYS } from '../js/core/nutrition.js';
import foods from '../data/foods-starter.json' with { type: 'json' };

const s = createSuite('foods-starter');
const { test, eq, ok } = s;

// --- overall shape -----------------------------------------------------------
test('foods-starter is a non-empty array with at least 50 records', () => {
  ok(Array.isArray(foods), 'foods-starter.json should be an array');
  ok(foods.length >= 50, `expected >= 50 records, got ${foods.length}`);
});

// --- id / source --------------------------------------------------------------
test('every id is unique and starts with "seed:"; source is "seed"', () => {
  const seen = new Set();
  for (const f of foods) {
    ok(typeof f.id === 'string' && f.id.startsWith('seed:'), `bad id: ${f.id}`);
    ok(!seen.has(f.id), `duplicate id: ${f.id}`);
    seen.add(f.id);
    eq(f.source, 'seed', `source should be "seed" for ${f.id}`);
  }
});

// --- name / servings -----------------------------------------------------------
test('every record has a non-empty name and valid servings', () => {
  for (const f of foods) {
    ok(typeof f.name === 'string' && f.name.trim().length > 0, `missing name for ${f.id}`);
    ok(Array.isArray(f.servings) && f.servings.length >= 1, `servings should be a non-empty array for ${f.id}`);

    const first = f.servings[0];
    eq(first.label, '100 g', `first serving label should be "100 g" for ${f.id}`);
    eq(first.grams, 100, `first serving grams should be 100 for ${f.id}`);

    for (const serving of f.servings) {
      ok(typeof serving.grams === 'number' && Number.isFinite(serving.grams) && serving.grams > 0,
        `serving grams should be a positive number for ${f.id} (${serving.label})`);
    }
  }
});

// --- per100g ---------------------------------------------------------------
test('every per100g has exactly the 13 canonical NUTRIENT_KEYS, each a finite number >= 0', () => {
  for (const f of foods) {
    const keys = Object.keys(f.per100g || {});
    eq(keys.length, 13, `per100g should have exactly 13 keys for ${f.id}, got ${keys.length}: ${keys.join(', ')}`);
    for (const key of NUTRIENT_KEYS) {
      ok(Object.prototype.hasOwnProperty.call(f.per100g, key), `per100g missing ${key} for ${f.id}`);
      const value = f.per100g[key];
      ok(typeof value === 'number' && Number.isFinite(value) && value >= 0,
        `per100g.${key} should be a finite number >= 0 for ${f.id}, got ${value}`);
    }
  }
});

// --- sanity: plausible kcal range (catches decimal-place typos) ------------
test('kcal is within a plausible range (0-950) for every record', () => {
  for (const f of foods) {
    const kcal = f.per100g.kcal;
    ok(kcal >= 0 && kcal <= 950, `implausible kcal for ${f.id}: ${kcal}`);
  }
});

// --- run -----------------------------------------------------------------
const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}

export default s;
