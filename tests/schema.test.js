// Pure tests for schema.js — key coverage, defaults, mergeSettings deep-merge
// + legacy backfill, and dataset validation. Runs in Node and tests/index.html.

import { createSuite, reportToConsole } from './harness.js';
import {
  KEYS,
  KIND,
  defaults,
  defaultFor,
  defaultSettings,
  mergeSettings,
  validateDataset,
} from '../js/core/schema.js';

const s = createSuite('schema');
const { test, eq, deepEq, ok } = s;

// --- key coverage ----------------------------------------------------------
test('every key has a KIND and a default', () => {
  for (const key of KEYS) {
    ok(KIND[key] === 'object' || KIND[key] === 'map' || KIND[key] === 'array', `KIND missing for ${key}`);
    ok(defaultFor(key) !== null, `default missing for ${key}`);
  }
});

test('KIND has no orphan entries', () => {
  for (const key of Object.keys(KIND)) ok(KEYS.includes(key), `KIND has unknown key ${key}`);
});

test('defaults() shape matches KIND per key', () => {
  const d = defaults('2026-01-01T00:00:00.000Z');
  for (const key of KEYS) {
    if (KIND[key] === 'array') ok(Array.isArray(d[key]), `${key} default should be an array`);
    else ok(d[key] && typeof d[key] === 'object' && !Array.isArray(d[key]), `${key} default should be an object`);
  }
});

test('v2 keys are present', () => {
  for (const key of ['ergoChecklist', 'postureCamLog', 'sleepLog', 'flareLog', 'medLog', 'weightLog', 'breathLog', 'activityLog']) {
    ok(KEYS.includes(key), `${key} should be in KEYS`);
  }
  eq(KIND.flareLog, 'array');
  eq(KIND.postureCamLog, 'map');
});

test('meta default gains lastReviewWeekSeen', () => {
  eq(defaults().meta.lastReviewWeekSeen, null);
});

// --- defaultSettings v2 shape ----------------------------------------------
test('defaultSettings has v2 camera shape', () => {
  const d = defaultSettings();
  eq(d.postureCamera.activeProfile, 'sitting');
  deepEq(d.postureCamera.profiles.sitting, { baseline: null, calibratedAt: null });
  deepEq(d.postureCamera.profiles.standing, { baseline: null, calibratedAt: null });
  eq(d.postureCamera.overlay, true);
  eq(d.postureCamera.alerts.sound, false);
  eq(d.postureCamera.dismissedMobileAdvice, false);
});

test('defaultSettings has flare/meds/wellbeing/onboardedAt', () => {
  const d = defaultSettings();
  eq(d.flare.goalReductionPct, 50);
  deepEq(d.meds.reminderTimes, []);
  eq(d.wellbeing.weightEnabled, false);
  eq(d.wellbeing.weightUnit, 'kg');
  eq(d.onboardedAt, null);
});

// --- mergeSettings ----------------------------------------------------------
test('mergeSettings({}) returns the full default shape', () => {
  deepEq(mergeSettings({}), defaultSettings());
});

test('mergeSettings tolerates null/garbage input', () => {
  deepEq(mergeSettings(null), defaultSettings());
  deepEq(mergeSettings('nope'), defaultSettings());
});

test('mergeSettings keeps stored values, fills gaps (deep)', () => {
  const m = mergeSettings({
    theme: 'dark',
    reminders: { enabled: true },
    postureCamera: { sensitivity: 0.8 },
  });
  eq(m.theme, 'dark');
  eq(m.reminders.enabled, true);
  eq(m.reminders.postureIntervalMin, 30, 'missing reminder field filled');
  eq(m.reminders.activeHours.start, '08:00', 'missing nested object filled');
  eq(m.postureCamera.sensitivity, 0.8);
  eq(m.postureCamera.activeProfile, 'sitting', 'missing v2 camera field filled');
  ok(m.postureCamera.profiles.sitting, 'profiles object exists after merge');
  eq(m.flare.goalReductionPct, 50, 'missing v2 top-level section filled');
});

test('mergeSettings backfills legacy baseline into sitting profile', () => {
  const legacy = { verticalGap: 1.2, lateralOffset: 0.1, shoulderTilt: 0.02 };
  const m = mergeSettings({ postureCamera: { baseline: legacy } });
  deepEq(m.postureCamera.profiles.sitting.baseline, legacy, 'backfilled');
  deepEq(m.postureCamera.baseline, legacy, 'legacy field kept');
  eq(m.postureCamera.profiles.sitting.calibratedAt, null, 'no fake timestamp invented');
});

test('mergeSettings never clobbers an existing profile baseline with legacy', () => {
  const legacy = { verticalGap: 1.2, lateralOffset: 0, shoulderTilt: 0 };
  const current = { verticalGap: 1.5, lateralOffset: 0, shoulderTilt: 0 };
  const m = mergeSettings({
    postureCamera: {
      baseline: legacy,
      profiles: { sitting: { baseline: current, calibratedAt: '2026-06-30T00:00:00.000Z' } },
    },
  });
  deepEq(m.postureCamera.profiles.sitting.baseline, current);
  eq(m.postureCamera.profiles.sitting.calibratedAt, '2026-06-30T00:00:00.000Z');
});

test('mergeSettings is idempotent', () => {
  const once = mergeSettings({ theme: 'light', postureCamera: { baseline: { verticalGap: 1 } } });
  deepEq(mergeSettings(once), once);
});

// --- validateDataset ---------------------------------------------------------
test('validateDataset accepts a full default dataset', () => {
  const res = validateDataset(defaults('2026-01-01T00:00:00.000Z'));
  ok(res.ok, res.errors.join('; '));
});

test('validateDataset rejects wrong kinds for v2 keys', () => {
  eq(validateDataset({ flareLog: {} }).ok, false, 'flareLog must be an array');
  eq(validateDataset({ sleepLog: [] }).ok, false, 'sleepLog must be an object');
  eq(validateDataset({ postureCamLog: 3 }).ok, false, 'postureCamLog must be an object');
});

test('validateDataset still tolerates missing and unknown keys', () => {
  ok(validateDataset({}).ok, 'all keys missing is fine');
  ok(validateDataset({ someFutureKey: [1, 2] }).ok, 'unknown keys ignored');
});

// --- run -----------------------------------------------------------------
const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}

export default s;
