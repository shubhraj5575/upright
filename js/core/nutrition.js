// Nutrition core: USDA/OFF normalization, per-serving scaling, and daily
// rollups. The pure functions below (normalizeUsdaFood, normalizeOffProduct,
// scaleNutrients, dailyTotals, targetStatus) are fully unit-tested in
// tests/nutrition.test.js. The `fetch` wrappers at the bottom of this file are
// thin, network-only glue and are intentionally NOT unit-tested — USDA search
// terms leave the device; logged nutrition data never does.

export const NUTRIENT_KEYS = [
  'kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g',
  'sugar_g', 'sodium_mg', 'calcium_mg', 'vitD_ug',
  'magnesium_mg', 'potassium_mg', 'iron_mg', 'omega3_g',
];

// Build an { fdcNutrientId(number): amount } map from a foodNutrients array,
// tolerating both the nested detail shape (`entry.nutrient.id`, `entry.amount`)
// and the flat search shape (`entry.nutrientId`, `entry.value`). Critically,
// this keys by the FDC nutrient id (a stable integer, e.g. 1008) and NEVER by
// `nutrient.number`/`nutrientNumber` (a legacy NDB code string like "208") —
// mapping by the legacy code silently returns all-zeros.
function indexUsdaNutrientsById(foodNutrients) {
  const byId = {};
  for (const entry of foodNutrients || []) {
    const rawId = entry?.nutrient?.id ?? entry?.nutrientId;
    const id = Number(rawId);
    const amount = entry?.amount ?? entry?.value;
    if (Number.isFinite(id) && amount != null) byId[id] = amount;
  }
  return byId;
}

function per100gFromUsdaById(byId) {
  return {
    kcal: byId[1008] ?? 0, // ONLY id 1008; ignore kJ energy ids (1062/2047/2048)
    protein_g: byId[1003] ?? 0,
    fat_g: byId[1004] ?? 0,
    carb_g: byId[1005] ?? 0,
    fiber_g: byId[1079] ?? 0,
    sugar_g: byId[2000] ?? byId[1063] ?? 0, // fallback: "Sugars, Total NLEA"
    sodium_mg: byId[1093] ?? 0,
    calcium_mg: byId[1087] ?? 0,
    vitD_ug: byId[1114] ?? 0,
    magnesium_mg: byId[1090] ?? 0,
    potassium_mg: byId[1092] ?? 0,
    iron_mg: byId[1089] ?? 0,
    omega3_g: (byId[1278] ?? 0) + (byId[1272] ?? 0), // EPA + DHA
  };
}

/**
 * Normalize a USDA FoodData Central food object (either a `/food/{id}` detail
 * response, or a single entry from `/foods/search`'s `foods[]` array) into
 * our canonical shape. Pure and clock-free — the caller stamps `fetchedAt`
 * when caching.
 */
export function normalizeUsdaFood(json) {
  const byId = indexUsdaNutrientsById(json?.foodNutrients);
  const per100g = per100gFromUsdaById(byId);

  const servings = [{ label: '100 g', grams: 100 }];
  if (Array.isArray(json?.foodPortions)) {
    for (const p of json.foodPortions) {
      const grams = p?.gramWeight;
      if (typeof grams === 'number' && Number.isFinite(grams)) {
        servings.push({ label: p.portionDescription || p.modifier || 'portion', grams });
      }
    }
  }

  return {
    id: 'usda:' + json.fdcId,
    source: 'usda',
    name: json.description,
    brand: json.brandOwner || json.brandName || null,
    servings,
    per100g,
  };
}

/**
 * Normalize an Open Food Facts `/api/v2/product/{code}.json` response into
 * our canonical shape. OFF's micro-nutrient coverage is poor by nature of
 * community data entry; missing nutriments default to 0.
 */
export function normalizeOffProduct(json) {
  const product = json?.product || {};
  const n = product.nutriments || {};

  const per100g = {
    kcal: n['energy-kcal_100g'] ?? 0,
    protein_g: n.proteins_100g ?? 0,
    carb_g: n.carbohydrates_100g ?? 0,
    fat_g: n.fat_100g ?? 0,
    fiber_g: n.fiber_100g ?? 0,
    sugar_g: n.sugars_100g ?? 0,
    sodium_mg: (n.sodium_100g ?? 0) * 1000,
    calcium_mg: (n.calcium_100g ?? 0) * 1000,
    iron_mg: (n.iron_100g ?? 0) * 1000,
    potassium_mg: (n.potassium_100g ?? 0) * 1000,
    magnesium_mg: (n.magnesium_100g ?? 0) * 1000,
    vitD_ug: (n['vitamin-d_100g'] ?? 0) * 1e6,
    omega3_g: n['omega-3-fat_100g'] ?? 0,
  };

  return {
    id: 'off:' + (json?.code || product?.code),
    source: 'off',
    name: product.product_name || '',
    brand: product.brands || null,
    servings: [{ label: '100 g', grams: 100 }],
    per100g,
  };
}

/**
 * Scale a per-100g nutrient snapshot to an arbitrary gram amount. Full
 * precision — no rounding (rounding is a display concern, not a data one).
 */
export function scaleNutrients(per100g, grams) {
  const out = {};
  for (const key of NUTRIENT_KEYS) {
    out[key] = ((per100g && per100g[key]) || 0) * grams / 100;
  }
  return out;
}

/**
 * Sum per-entry nutrient snapshots (`entry.nutrients`) across a day's logged
 * entries. Entries missing `.nutrients` (legacy tag-only meals) contribute 0
 * and must not throw.
 */
export function dailyTotals(entries) {
  const totals = {};
  for (const key of NUTRIENT_KEYS) totals[key] = 0;
  for (const entry of entries || []) {
    const nutrients = entry && entry.nutrients;
    if (!nutrients) continue;
    for (const key of NUTRIENT_KEYS) totals[key] += nutrients[key] || 0;
  }
  return totals;
}

/**
 * Compare daily totals against configured targets, one row per target key.
 */
export function targetStatus(totals, targets) {
  const rows = [];
  for (const key of Object.keys(targets || {})) {
    const amount = (totals && totals[key]) || 0;
    const target = targets[key];
    const pct = target > 0 ? (amount / target) * 100 : 0;
    rows.push({ key, amount, target, pct });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Thin fetch wrappers — network-only, intentionally NOT unit-tested.
// ---------------------------------------------------------------------------

export const DEMO_KEY = 'DEMO_KEY';

export function resolveKey(userKey) {
  return userKey && userKey.trim() ? userKey.trim() : DEMO_KEY;
}

export async function searchFoods(query, userKey) {
  const key = resolveKey(userKey);
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)&pageSize=20`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error('usda_search_failed'), { status: res.status });
  const json = await res.json();
  return json.foods || [];
}

export async function getFood(fdcId, userKey) {
  const key = resolveKey(userKey);
  const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw Object.assign(new Error('usda_food_failed'), { status: res.status });
  return res.json();
}

export async function lookupBarcode(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  return res.json();
}
