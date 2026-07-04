// Pure tests for nutrition.js — USDA/OFF normalization, scaling, rollup, and
// target-status math. The fetch wrappers at the bottom of nutrition.js are
// intentionally NOT covered here (network-only, thin). Runs in Node and
// tests/index.html.

import { createSuite, reportToConsole } from './harness.js';
import {
  NUTRIENT_KEYS,
  normalizeUsdaFood,
  normalizeOffProduct,
  scaleNutrients,
  dailyTotals,
  targetStatus,
} from '../js/core/nutrition.js';
import { defaultSettings } from '../js/core/schema.js';

import salmonOil from './fixtures/usda-food-172343-salmon-oil.json' with { type: 'json' };
import broccoliSearch from './fixtures/usda-search-broccoli.json' with { type: 'json' };

const s = createSuite('nutrition');
const { test, eq, deepEq, ok } = s;

// --- NUTRIENT_KEYS ----------------------------------------------------------
test('NUTRIENT_KEYS has the 13 canonical keys', () => {
  eq(NUTRIENT_KEYS.length, 13);
  for (const key of [
    'kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g',
    'sugar_g', 'sodium_mg', 'calcium_mg', 'vitD_ug',
    'magnesium_mg', 'potassium_mg', 'iron_mg', 'omega3_g',
  ]) {
    ok(NUTRIENT_KEYS.includes(key), `NUTRIENT_KEYS missing ${key}`);
  }
});

// --- normalizeUsdaFood: detail (nested) shape -------------------------------
test('normalizeUsdaFood(salmonOil): id and source', () => {
  const n = normalizeUsdaFood(salmonOil);
  eq(n.id, 'usda:172343');
  eq(n.source, 'usda');
  eq(n.name, 'Fish oil, salmon');
  eq(n.brand, null);
});

test('normalizeUsdaFood(salmonOil): per100g has all 13 keys with correct values', () => {
  const n = normalizeUsdaFood(salmonOil);
  for (const key of NUTRIENT_KEYS) {
    ok(Object.prototype.hasOwnProperty.call(n.per100g, key), `per100g missing ${key}`);
  }
  eq(n.per100g.kcal, 902, 'kcal from id 1008 only (not kJ 1062)');
  eq(n.per100g.fat_g, 100);
  eq(n.per100g.protein_g, 0, 'true zero, not defaulted-away');
  eq(n.per100g.sodium_mg, 0, 'true zero');
  ok(Math.abs(n.per100g.omega3_g - 31.255) < 0.001, `omega3_g should be EPA+DHA ≈ 31.255, got ${n.per100g.omega3_g}`);
});

test('normalizeUsdaFood(salmonOil): servings include 100g plus foodPortions', () => {
  const n = normalizeUsdaFood(salmonOil);
  ok(n.servings.some((sv) => sv.label === '100 g' && sv.grams === 100), '100 g baseline serving present');
  ok(n.servings.some((sv) => sv.label === 'tsp' && sv.grams === 4.5), 'tsp portion present');
  ok(n.servings.some((sv) => sv.label === 'tbsp' && sv.grams === 13.6), 'tbsp portion present');
  ok(n.servings.some((sv) => sv.label === 'cup' && sv.grams === 218), 'cup portion present');
  eq(n.servings.length, 4, '1 baseline + 3 foodPortions');
});

test('normalizeUsdaFood does not stamp fetchedAt (stays pure/clock-free)', () => {
  const n = normalizeUsdaFood(salmonOil);
  ok(!Object.prototype.hasOwnProperty.call(n, 'fetchedAt'), 'fetchedAt should not be set by the normalizer');
});

// --- normalizeUsdaFood: search (flat) shape ---------------------------------
test('normalizeUsdaFood(broccoliSearch.foods[0]): flat nutrientId shape', () => {
  const food = broccoliSearch.foods[0];
  const byId = {};
  for (const fn of food.foodNutrients) byId[fn.nutrientId] = fn.value;

  const n = normalizeUsdaFood(food);
  eq(n.id, `usda:${food.fdcId}`);
  eq(n.per100g.kcal, byId[1008]);
  eq(n.per100g.protein_g, byId[1003]);
  eq(n.per100g.fiber_g, byId[1079]);
});

test('normalizeUsdaFood(broccoliSearch.foods[0]): sugar_g falls back to id 1063 when 2000 absent', () => {
  const food = broccoliSearch.foods[0];
  const has2000 = food.foodNutrients.some((fn) => fn.nutrientId === 2000);
  ok(!has2000, 'fixture assumption: broccoli search result has no id 2000 (exercises fallback)');
  const n = normalizeUsdaFood(food);
  const byId = {};
  for (const fn of food.foodNutrients) byId[fn.nutrientId] = fn.value;
  eq(n.per100g.sugar_g, byId[1063]);
});

test('normalizeUsdaFood(broccoliSearch.foods[0]): no foodPortions → only 100g serving', () => {
  const n = normalizeUsdaFood(broccoliSearch.foods[0]);
  deepEq(n.servings, [{ label: '100 g', grams: 100 }]);
});

// --- id-not-number proof (THE critical bug to avoid) ------------------------
test('normalizeUsdaFood keys by nutrient.id, NOT nutrient.number (legacy NDB code)', () => {
  const fake = {
    fdcId: 1,
    description: 'x',
    foodNutrients: [
      { nutrient: { id: 1008, number: '208', unitName: 'KCAL' }, amount: 100 },
    ],
  };
  const n = normalizeUsdaFood(fake);
  eq(n.per100g.kcal, 100, 'must map by nutrient.id (1008), not nutrient.number ("208") — would be 0 if keyed wrong');
});

test('normalizeUsdaFood coerces string ids to numbers defensively', () => {
  const fake = {
    fdcId: 2,
    description: 'y',
    foodNutrients: [
      { nutrient: { id: '1003', number: '203' }, amount: 12 },
    ],
  };
  const n = normalizeUsdaFood(fake);
  eq(n.per100g.protein_g, 12);
});

// --- normalizeOffProduct -----------------------------------------------------
test('normalizeOffProduct maps nutriments and converts g→mg/µg', () => {
  const json = {
    code: '3017620422003',
    product: {
      code: '3017620422003',
      product_name: 'Nutella',
      brands: 'Ferrero',
      nutriments: {
        'energy-kcal_100g': 539,
        proteins_100g: 6.3,
        carbohydrates_100g: 57.5,
        fat_100g: 30.9,
        fiber_100g: 3.4,
        sugars_100g: 56.3,
        sodium_100g: 0.107,
        calcium_100g: 0.12,
        iron_100g: 0.003,
        potassium_100g: 0.35,
        magnesium_100g: 0.025,
        'vitamin-d_100g': 0.000002,
        'omega-3-fat_100g': 0.5,
      },
    },
  };
  const n = normalizeOffProduct(json);
  eq(n.id, 'off:3017620422003');
  eq(n.source, 'off');
  eq(n.name, 'Nutella');
  eq(n.brand, 'Ferrero');
  deepEq(n.servings, [{ label: '100 g', grams: 100 }]);
  eq(n.per100g.kcal, 539);
  eq(n.per100g.protein_g, 6.3);
  eq(n.per100g.carb_g, 57.5);
  eq(n.per100g.fat_g, 30.9);
  eq(n.per100g.fiber_g, 3.4);
  eq(n.per100g.sugar_g, 56.3);
  eq(n.per100g.sodium_mg, 107, 'g→mg ×1000');
  eq(n.per100g.calcium_mg, 120);
  eq(n.per100g.iron_mg, 3);
  eq(n.per100g.potassium_mg, 350);
  eq(n.per100g.magnesium_mg, 25);
  ok(Math.abs(n.per100g.vitD_ug - 2) < 1e-9, 'g→µg ×1e6');
  eq(n.per100g.omega3_g, 0.5);
});

test('normalizeOffProduct defaults missing nutriments to 0 (poor micro coverage expected)', () => {
  const json = { code: '000', product: { product_name: 'Bare', nutriments: {} } };
  const n = normalizeOffProduct(json);
  for (const key of NUTRIENT_KEYS) eq(n.per100g[key], 0, `${key} should default to 0`);
});

test('normalizeOffProduct falls back to json.product.code if json.code absent', () => {
  const json = { product: { code: '999', product_name: 'z', nutriments: {} } };
  const n = normalizeOffProduct(json);
  eq(n.id, 'off:999');
});

// --- scaleNutrients ----------------------------------------------------------
test('scaleNutrients scales each key proportionally to grams', () => {
  const per100g = normalizeUsdaFood(salmonOil).per100g;
  const scaled = scaleNutrients(per100g, 150);
  eq(scaled.kcal, per100g.kcal * 1.5);
  eq(scaled.fat_g, per100g.fat_g * 1.5);
  ok(Math.abs(scaled.omega3_g - per100g.omega3_g * 1.5) < 1e-9);
});

test('scaleNutrients at 0 grams gives all-zeros', () => {
  const per100g = normalizeUsdaFood(salmonOil).per100g;
  const scaled = scaleNutrients(per100g, 0);
  for (const key of NUTRIENT_KEYS) eq(scaled[key], 0, `${key} should be 0`);
});

test('scaleNutrients treats missing per100g keys as 0', () => {
  const scaled = scaleNutrients({ kcal: 200 }, 50);
  eq(scaled.kcal, 100);
  eq(scaled.protein_g, 0);
});

// --- dailyTotals --------------------------------------------------------------
test('dailyTotals sums entry.nutrients key-by-key across entries', () => {
  const a = { nutrients: { kcal: 100, protein_g: 10, carb_g: 0, fat_g: 5, fiber_g: 0, sugar_g: 0, sodium_mg: 50, calcium_mg: 0, vitD_ug: 0, magnesium_mg: 0, potassium_mg: 0, iron_mg: 0, omega3_g: 0 } };
  const b = { nutrients: { kcal: 50, protein_g: 5, carb_g: 20, fat_g: 0, fiber_g: 2, sugar_g: 1, sodium_mg: 0, calcium_mg: 30, vitD_ug: 0, magnesium_mg: 0, potassium_mg: 0, iron_mg: 0, omega3_g: 0.2 } };
  const totals = dailyTotals([a, b]);
  eq(totals.kcal, 150);
  eq(totals.protein_g, 15);
  eq(totals.carb_g, 20);
  eq(totals.fat_g, 5);
  eq(totals.fiber_g, 2);
  eq(totals.sugar_g, 1);
  eq(totals.sodium_mg, 50);
  eq(totals.calcium_mg, 30);
  ok(Math.abs(totals.omega3_g - 0.2) < 1e-9);
});

test('dailyTotals: legacy tag-only entries (no .nutrients) contribute 0 and do not throw', () => {
  const a = { nutrients: { kcal: 100, protein_g: 0, carb_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, calcium_mg: 0, vitD_ug: 0, magnesium_mg: 0, potassium_mg: 0, iron_mg: 0, omega3_g: 0 } };
  const legacy = { name: 'x', t: '2026-07-04T08:00:00.000Z' };
  let totals;
  let threw = false;
  try {
    totals = dailyTotals([a, legacy]);
  } catch (_) {
    threw = true;
  }
  ok(!threw, 'dailyTotals must not throw on entries lacking .nutrients');
  eq(totals.kcal, 100);
});

test('dailyTotals([]) returns all 13 keys at 0', () => {
  const totals = dailyTotals([]);
  for (const key of NUTRIENT_KEYS) eq(totals[key], 0, `${key} should default to 0`);
});

// --- targetStatus --------------------------------------------------------------
test('targetStatus computes pct per key against the default targets', () => {
  const targets = defaultSettings().nutrition.targets;
  const totals = { kcal: 1000, protein_g: 30 };
  const rows = targetStatus(totals, targets);
  eq(rows.length, Object.keys(targets).length, 'one row per target key');
  const kcalRow = rows.find((r) => r.key === 'kcal');
  eq(kcalRow.amount, 1000);
  eq(kcalRow.target, targets.kcal);
  eq(kcalRow.pct, (1000 / targets.kcal) * 100);
});

test('targetStatus: amount 1000 / target 2000 → pct 50', () => {
  const rows = targetStatus({ kcal: 1000 }, { kcal: 2000 });
  eq(rows.length, 1);
  eq(rows[0].pct, 50);
});

test('targetStatus: missing totals key defaults amount to 0', () => {
  const rows = targetStatus({}, { protein_g: 60 });
  eq(rows[0].amount, 0);
  eq(rows[0].pct, 0);
});

test('targetStatus: target of 0 yields pct 0 (no divide-by-zero)', () => {
  const rows = targetStatus({ kcal: 500 }, { kcal: 0 });
  eq(rows[0].pct, 0);
});

// --- run -----------------------------------------------------------------
const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}

export default s;
