// schema.js — the shape of everything we persist. Single source of truth for
// storage keys, their default values, and import validation. Pure: no DOM, no
// localStorage. Bump SCHEMA_VERSION only when a migration is introduced.

export const SCHEMA_VERSION = 1;

/** Every top-level storage key. Order here is the order used by export. */
export const KEYS = [
  'meta',
  'settings',
  'painLog',
  'postureSelfLog',
  'goalsLog',
  'exercises',
  'exerciseLog',
  'mealPlan',
  'mealLog',
];

/**
 * How each key is merged on import (see backup.js):
 *  - 'object': singleton record; additive merge fills only missing fields.
 *  - 'map':    day-keyed (or id-keyed) dictionary; additive merge adds only
 *              missing entries (local wins on collision).
 *  - 'array':  list of records with an `id`; additive merge appends only new ids.
 */
export const KIND = {
  meta: 'object',
  settings: 'object',
  painLog: 'map',
  postureSelfLog: 'map',
  goalsLog: 'map',
  exercises: 'array',
  exerciseLog: 'map',
  mealPlan: 'object',
  mealLog: 'map',
};

/** Default settings — referenced by modules so config has stable shape. */
export function defaultSettings() {
  return {
    theme: 'system', // 'system' | 'light' | 'dark'
    streakGrace: 1, // missed days forgiven before a streak breaks
    reminders: {
      enabled: false,
      postureIntervalMin: 30, // sit-check cadence
      movementIntervalMin: 50, // get-up-and-move cadence
      activeHours: { start: '08:00', end: '20:00' },
    },
    goals: {
      waterMl: 2000,
      waterStepMl: 250,
      steps: 6000,
    },
    postureCamera: {
      baseline: null, // calibrated "sit tall" keypoint snapshot (Phase 5)
      sensitivity: 0.5, // 0..1
      enabled: false,
    },
    physioConstraints: '', // free text — the user's real physio instructions
    disclaimerAckAt: null, // ISO timestamp when the disclaimer was acknowledged
  };
}

/**
 * A complete, empty-but-valid dataset. `createdAt` is injected by the caller
 * (store seeding) so this module stays free of Date/clock dependencies.
 */
export function defaults(createdAt = null) {
  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      createdAt, // ISO timestamp, set at first-run seeding
      lastBackupAt: null, // ISO timestamp of last export
    },
    settings: defaultSettings(),
    painLog: {}, // dayKey -> { pain:0..10, stiffness:0..10, mood?, notes? }
    postureSelfLog: {}, // dayKey -> [{ t: ISO, rating: 1..5 }]
    goalsLog: {}, // dayKey -> { waterMl, steps }
    exercises: [], // [{ id, name, ... }] — seeded from /data in Phase 3
    exerciseLog: {}, // dayKey -> [exerciseId, ...]
    mealPlan: {}, // weekly grid — seeded from /data in Phase 3
    mealLog: {}, // dayKey -> [{ name, tags:[], t: ISO }]
  };
}

/**
 * Backfill any settings fields a stored settings object is missing (e.g. after
 * an app update adds a new control). Stored values always win; only absent keys
 * are filled from defaults. Run on every boot — idempotent.
 */
export function mergeSettings(stored) {
  const d = defaultSettings();
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ...d,
    ...s,
    reminders: {
      ...d.reminders,
      ...(s.reminders || {}),
      activeHours: { ...d.reminders.activeHours, ...((s.reminders || {}).activeHours || {}) },
    },
    goals: { ...d.goals, ...(s.goals || {}) },
    postureCamera: { ...d.postureCamera, ...(s.postureCamera || {}) },
  };
}

/** Default value for a single key (used by store.get fallbacks). */
export function defaultFor(key) {
  const d = defaults();
  return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : null;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate a parsed import payload's `data` object before it's allowed to
 * touch storage. We're lenient about extra fields (forward-compat) but strict
 * that known keys have the right *kind*, so a corrupt file can't poison state.
 * @param {any} data
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateDataset(data) {
  const errors = [];
  if (!isPlainObject(data)) {
    return { ok: false, errors: ['dataset is not an object'] };
  }
  for (const key of KEYS) {
    if (!(key in data)) continue; // missing keys are fine (additive / defaults)
    const val = data[key];
    const kind = KIND[key];
    if (kind === 'array') {
      if (!Array.isArray(val)) errors.push(`"${key}" should be an array`);
    } else if (kind === 'map' || kind === 'object') {
      if (!isPlainObject(val)) errors.push(`"${key}" should be an object`);
    }
  }
  return { ok: errors.length === 0, errors };
}
