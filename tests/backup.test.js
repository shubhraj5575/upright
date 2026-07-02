// Pure round-trip + merge-semantics tests for backup.js. No localStorage is
// touched (we test the transforms with explicit datasets), so this runs both
// headless (`node tests/backup.test.js`) and in tests/index.html.

import { createSuite, reportToConsole } from './harness.js';
import {
  buildExport,
  serializeExport,
  parseImport,
  mergeDatasets,
  MERGE,
  REPLACE,
} from '../js/core/backup.js';

const s = createSuite('backup');
const { test, eq, deepEq, ok } = s;

function sample() {
  return {
    meta: { schemaVersion: 1, createdAt: '2026-06-01T00:00:00.000Z', lastBackupAt: null },
    settings: { physioConstraints: 'no loaded flexion', goals: { waterMl: 2000 } },
    painLog: { '2026-06-15': { pain: 3, stiffness: 4 } },
    postureSelfLog: {},
    goalsLog: { '2026-06-15': { waterMl: 1500, steps: 4000 } },
    exercises: [{ id: 'cat-cow', name: 'Cat-Cow' }],
    exerciseLog: { '2026-06-15': ['cat-cow'] },
    mealPlan: {},
    mealLog: {},
    ergoChecklist: { 'desk-height': true },
    postureCamLog: {
      '2026-06-15': {
        monitoredMs: 3600000, goodMs: 3000000, poorMs: 500000, awayMs: 100000,
        slouchEvents: 4, worstStreakMs: 60000, scoreSum: 8200, scoreCount: 100,
        sessions: 2, awayCount: 1, lastSessionEndedAt: '2026-06-15T16:00:00.000Z',
      },
    },
    sleepLog: { '2026-06-15': { hours: 7, quality: 4, position: 'side', wokeStiff: false, t: '2026-06-15T07:10:00.000Z' } },
    flareLog: [{ id: 'f1', startedAt: '2026-06-01T09:00:00.000Z', startDay: '2026-06-01', endedAt: '2026-06-04T09:00:00.000Z', endDay: '2026-06-04', severity: 6, trigger: 'lifting', notes: '' }],
    medLog: { '2026-06-15': [{ t: '2026-06-15T08:00:00.000Z', name: 'Ibuprofen', dose: '400mg' }] },
    weightLog: { '2026-06-15': { kg: 78.4, t: '2026-06-15T07:00:00.000Z' } },
    breathLog: { '2026-06-15': [{ t: '2026-06-15T12:00:00.000Z', durationSec: 120, kind: 'box' }] },
    activityLog: { '2026-06-15': { sittingMin: 320, breaks: 5 } },
  };
}

// --- round-trip ----------------------------------------------------------
test('export → serialize → parse restores the data exactly', () => {
  const data = sample();
  const text = serializeExport(data, '2026-06-16T10:00:00.000Z');
  const parsed = parseImport(text);
  ok(parsed.ok, 'parse should succeed');
  deepEq(parsed.data, data, 'round-tripped data should equal original');
});

test('buildExport wraps with envelope + version', () => {
  const env = buildExport(sample(), '2026-06-16T10:00:00.000Z');
  eq(env.__upright, true);
  eq(env.schemaVersion, 1);
  eq(env.exportedAt, '2026-06-16T10:00:00.000Z');
});

test('parseImport accepts a bare dataset (no envelope)', () => {
  const parsed = parseImport(JSON.stringify(sample()));
  ok(parsed.ok);
  deepEq(parsed.data.painLog, sample().painLog);
});

test('parseImport rejects junk', () => {
  eq(parseImport('not json{').ok, false);
  eq(parseImport(JSON.stringify({ data: { exercises: 'nope' } })).ok, false);
});

// --- REPLACE -------------------------------------------------------------
test('replace takes incoming wholesale, defaults for missing keys', () => {
  const base = sample();
  const incoming = { painLog: { '2026-06-10': { pain: 8, stiffness: 7 } } };
  const merged = mergeDatasets(base, incoming, REPLACE);
  deepEq(merged.painLog, incoming.painLog, 'incoming replaces local painLog');
  deepEq(merged.exercises, [], 'missing key falls back to default ([])');
});

// --- MERGE (additive, local wins) ----------------------------------------
test('merge keeps local entry on day-key collision (local wins)', () => {
  const base = { painLog: { '2026-06-15': { pain: 3, stiffness: 4 } } };
  const incoming = { painLog: { '2026-06-15': { pain: 9, stiffness: 9 }, '2026-06-10': { pain: 2 } } };
  const merged = mergeDatasets(base, incoming, MERGE);
  deepEq(merged.painLog['2026-06-15'], { pain: 3, stiffness: 4 }, 'local wins collision');
  deepEq(merged.painLog['2026-06-10'], { pain: 2 }, 'incoming-only entry is added');
});

test('merge fills only missing object fields (local wins)', () => {
  const base = { settings: { goals: { waterMl: 2000 } } };
  const incoming = { settings: { goals: { waterMl: 9999 }, physioConstraints: 'avoid lifting' } };
  const merged = mergeDatasets(base, incoming, MERGE);
  eq(merged.settings.goals.waterMl, 2000, 'local field wins');
  eq(merged.settings.physioConstraints, 'avoid lifting', 'missing field filled from incoming');
});

test('merge arrays by id: append only new ids', () => {
  const base = { exercises: [{ id: 'cat-cow', name: 'Cat-Cow' }] };
  const incoming = {
    exercises: [
      { id: 'cat-cow', name: 'RENAMED' }, // collision → local kept
      { id: 'bird-dog', name: 'Bird-Dog' }, // new → appended
    ],
  };
  const merged = mergeDatasets(base, incoming, MERGE);
  eq(merged.exercises.length, 2);
  eq(merged.exercises[0].name, 'Cat-Cow', 'local item not overwritten');
  eq(merged.exercises[1].id, 'bird-dog', 'new item appended');
});

// --- run -----------------------------------------------------------------
const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}

export default s;
