// csv.js — PURE per-log CSV flattening for export. Data freedom is part of
// the local-first promise: any log can leave as a spreadsheet-friendly file.

export function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** rows: array of arrays → CRLF-joined CSV text. */
export function toCsv(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

const sortedDays = (log) => Object.keys(log || {}).sort();

/** Every exportable log: id, label, and a flattener → rows (incl. header). */
export const CSV_KINDS = [
  {
    id: 'painLog', label: 'Pain & symptoms',
    flatten: (log) => [
      ['day', 'pain', 'stiffness', 'mood', 'regions', 'notes'],
      ...sortedDays(log).map((day) => {
        const e = log[day] || {};
        return [day, e.pain, e.stiffness, e.mood, (e.regions || []).join('; '), e.notes];
      }),
    ],
  },
  {
    id: 'sleepLog', label: 'Sleep',
    flatten: (log) => [
      ['day', 'hours', 'quality', 'position', 'wokeStiff'],
      ...sortedDays(log).map((day) => {
        const e = log[day] || {};
        return [day, e.hours, e.quality, e.position, e.wokeStiff ? 'yes' : 'no'];
      }),
    ],
  },
  {
    id: 'goalsLog', label: 'Walk & water',
    flatten: (log) => [
      ['day', 'waterMl', 'steps'],
      ...sortedDays(log).map((day) => [day, (log[day] || {}).waterMl || 0, (log[day] || {}).steps || 0]),
    ],
  },
  {
    id: 'exerciseLog', label: 'Exercises done',
    flatten: (log) => [
      ['day', 'exerciseId'],
      ...sortedDays(log).flatMap((day) => (log[day] || []).map((id) => [day, id])),
    ],
  },
  {
    id: 'postureSelfLog', label: 'Posture check-ins',
    flatten: (log) => [
      ['day', 'time', 'rating'],
      ...sortedDays(log).flatMap((day) => (log[day] || []).map((e) => [day, e.t, e.rating])),
    ],
  },
  {
    id: 'postureCamLog', label: 'Camera posture sessions',
    flatten: (log) => [
      ['day', 'monitoredMin', 'goodMin', 'poorMin', 'awayMin', 'slouchEvents', 'worstStreakMin', 'avgScore', 'sessions', 'awayCount'],
      ...sortedDays(log).map((day) => {
        const d = log[day] || {};
        const min = (ms) => Math.round((ms || 0) / 60000 * 10) / 10;
        return [day, min(d.monitoredMs), min(d.goodMs), min(d.poorMs), min(d.awayMs),
          d.slouchEvents || 0, min(d.worstStreakMs),
          d.scoreCount ? Math.round(d.scoreSum / d.scoreCount) : '', d.sessions || 0, d.awayCount || 0];
      }),
    ],
  },
  {
    id: 'mealLog', label: 'Food',
    flatten: (log) => [
      ['day', 'time', 'meal', 'name', 'grams', 'kcal', 'protein_g', 'carb_g', 'fat_g', 'fiber_g',
        'sugar_g', 'sodium_mg', 'calcium_mg', 'vitD_ug', 'magnesium_mg', 'potassium_mg', 'iron_mg', 'omega3_g', 'tags'],
      ...sortedDays(log).flatMap((day) => (log[day] || []).map((e) => [
        day, e.t, e.meal || '', e.name, e.grams ?? '',
        (e.nutrients && e.nutrients.kcal != null) ? e.nutrients.kcal : '',
        (e.nutrients && e.nutrients.protein_g != null) ? e.nutrients.protein_g : '',
        (e.nutrients && e.nutrients.carb_g != null) ? e.nutrients.carb_g : '',
        (e.nutrients && e.nutrients.fat_g != null) ? e.nutrients.fat_g : '',
        (e.nutrients && e.nutrients.fiber_g != null) ? e.nutrients.fiber_g : '',
        (e.nutrients && e.nutrients.sugar_g != null) ? e.nutrients.sugar_g : '',
        (e.nutrients && e.nutrients.sodium_mg != null) ? e.nutrients.sodium_mg : '',
        (e.nutrients && e.nutrients.calcium_mg != null) ? e.nutrients.calcium_mg : '',
        (e.nutrients && e.nutrients.vitD_ug != null) ? e.nutrients.vitD_ug : '',
        (e.nutrients && e.nutrients.magnesium_mg != null) ? e.nutrients.magnesium_mg : '',
        (e.nutrients && e.nutrients.potassium_mg != null) ? e.nutrients.potassium_mg : '',
        (e.nutrients && e.nutrients.iron_mg != null) ? e.nutrients.iron_mg : '',
        (e.nutrients && e.nutrients.omega3_g != null) ? e.nutrients.omega3_g : '',
        (e.tags || []).join('; '),
      ])),
    ],
  },
  {
    id: 'medLog', label: 'Medications',
    flatten: (log) => [
      ['day', 'time', 'name', 'dose'],
      ...sortedDays(log).flatMap((day) => (log[day] || []).map((e) => [day, e.t, e.name, e.dose])),
    ],
  },
  {
    id: 'weightLog', label: 'Weight',
    flatten: (log) => [
      ['day', 'kg'],
      ...sortedDays(log).map((day) => [day, (log[day] || {}).kg]),
    ],
  },
  {
    id: 'breathLog', label: 'Breathing sessions',
    flatten: (log) => [
      ['day', 'time', 'durationSec', 'kind'],
      ...sortedDays(log).flatMap((day) => (log[day] || []).map((e) => [day, e.t, e.durationSec, e.kind])),
    ],
  },
  {
    id: 'activityLog', label: 'Sitting & breaks',
    flatten: (log) => [
      ['day', 'sittingMin', 'breaks'],
      ...sortedDays(log).map((day) => [day, (log[day] || {}).sittingMin || 0, (log[day] || {}).breaks || 0]),
    ],
  },
  {
    id: 'flareLog', label: 'Flare-ups',
    flatten: (log) => [
      ['startDay', 'endDay', 'severity', 'trigger', 'notes'],
      ...(Array.isArray(log) ? log : []).map((f) => [f.startDay, f.endDay || '(active)', f.severity, f.trigger, f.notes]),
    ],
  },
];

/** CSV text for one log kind (throws on unknown id). */
export function logToCsv(kindId, logData) {
  const kind = CSV_KINDS.find((k) => k.id === kindId);
  if (!kind) throw new Error(`unknown CSV kind: ${kindId}`);
  return toCsv(kind.flatten(logData));
}
