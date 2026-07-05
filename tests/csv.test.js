// Tests for csv.js — escaping, row shaping, per-log flatteners.

import { createSuite, reportToConsole } from './harness.js';
import { csvEscape, toCsv, logToCsv, CSV_KINDS } from '../js/core/csv.js';

const s = createSuite('csv');
const { test, eq, ok, throws } = s;

test('csvEscape quotes only when needed', () => {
  eq(csvEscape('plain'), 'plain');
  eq(csvEscape('a,b'), '"a,b"');
  eq(csvEscape('say "hi"'), '"say ""hi"""');
  eq(csvEscape('line\nbreak'), '"line\nbreak"');
  eq(csvEscape(null), '');
  eq(csvEscape(0), '0');
});

test('toCsv joins with CRLF and trailing newline', () => {
  eq(toCsv([['a', 'b'], [1, 2]]), 'a,b\r\n1,2\r\n');
});

test('every kind has a unique id and produces a header row', () => {
  eq(new Set(CSV_KINDS.map((k) => k.id)).size, CSV_KINDS.length);
  for (const kind of CSV_KINDS) {
    const rows = kind.flatten(kind.id === 'flareLog' ? [] : {});
    ok(Array.isArray(rows[0]) && rows[0].length >= 2, `${kind.id} header`);
  }
});

test('painLog flattens day-keyed entries in date order', () => {
  const csv = logToCsv('painLog', {
    '2026-07-02': { pain: 3, stiffness: 4, mood: 4, regions: ['lower-c', 'hip-l'], notes: 'long, drive' },
    '2026-07-01': { pain: 5, stiffness: 5 },
  });
  const lines = csv.trim().split('\r\n');
  eq(lines[0], 'day,pain,stiffness,mood,regions,notes');
  ok(lines[1].startsWith('2026-07-01'), 'sorted ascending');
  ok(lines[2].includes('lower-c; hip-l'), 'regions joined');
  ok(lines[2].includes('"long, drive"'), 'comma note quoted');
});

test('list logs expand one row per entry', () => {
  const csv = logToCsv('mealLog', {
    '2026-07-01': [{ t: 'T1', name: 'Salmon', tags: ['omega-3'] }, { t: 'T2', name: 'Oats', tags: [] }],
  });
  eq(csv.trim().split('\r\n').length, 3, 'header + 2 rows');
});

test('mealLog flattens modern entries with per-entry nutrient columns', () => {
  const csv = logToCsv('mealLog', {
    '2026-07-01': [{
      t: 'T', meal: 'lunch', name: 'Salmon', grams: 150,
      nutrients: {
        kcal: 300, protein_g: 40, carb_g: 0, fat_g: 15, fiber_g: 0, sugar_g: 0,
        sodium_mg: 80, calcium_mg: 20, vitD_ug: 14, magnesium_mg: 30, potassium_mg: 400, iron_mg: 1, omega3_g: 2.1,
      },
      tags: ['omega-3'],
    }],
  });
  const lines = csv.trim().split('\r\n');
  const header = lines[0];
  ok(header.includes('meal'), 'header has meal');
  ok(header.includes('grams'), 'header has grams');
  ok(header.includes('kcal'), 'header has kcal');
  ok(header.includes('protein_g'), 'header has protein_g');
  ok(header.includes('omega3_g'), 'header has omega3_g');
  const row = lines[1];
  ok(row.includes('lunch'), 'row has meal');
  ok(row.includes('150'), 'row has grams');
  ok(row.includes('300'), 'row has kcal');
  ok(row.includes('omega-3'), 'row has tags');
});

test('camera log converts ms to minutes and derives avg score', () => {
  const csv = logToCsv('postureCamLog', {
    '2026-07-01': { monitoredMs: 3600000, goodMs: 2700000, poorMs: 900000, awayMs: 0, slouchEvents: 2, worstStreakMs: 120000, scoreSum: 800, scoreCount: 10, sessions: 1, awayCount: 0 },
  });
  const row = csv.trim().split('\r\n')[1];
  ok(row.includes('60'), 'minutes not ms');
  ok(row.includes('80'), 'avg score 800/10');
});

test('flareLog marks active episodes', () => {
  const csv = logToCsv('flareLog', [{ startDay: '2026-07-01', endDay: null, severity: 6, trigger: 't', notes: '' }]);
  ok(csv.includes('(active)'));
});

test('unknown kind throws', () => {
  throws(() => logToCsv('nope', {}));
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
