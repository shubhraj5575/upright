// Tests for body-regions.js — vocabulary + tallies.

import { createSuite, reportToConsole } from './harness.js';
import { REGIONS, regionLabel, regionCounts, topRegions } from '../js/core/body-regions.js';

const s = createSuite('body-regions');
const { test, eq, ok, deepEq } = s;

test('nine unique regions with labels', () => {
  eq(REGIONS.length, 9);
  eq(new Set(REGIONS.map((r) => r.id)).size, 9);
  for (const r of REGIONS) ok(r.label && r.label.length > 2);
});

test('regionLabel falls back to the id for unknowns', () => {
  eq(regionLabel('lower-c'), 'Lower back · centre');
  eq(regionLabel('mystery'), 'mystery');
});

test('regionCounts tallies days, not entries', () => {
  const log = {
    d1: { pain: 4, regions: ['lower-c', 'hip-l'] },
    d2: { pain: 5, regions: ['lower-c'] },
    d3: { pain: 2 }, // no regions field — old entry, fine
  };
  deepEq(regionCounts(log, ['d1', 'd2', 'd3']), { 'lower-c': 2, 'hip-l': 1 });
  deepEq(regionCounts(log, ['d3']), {});
  deepEq(regionCounts({}, []), {});
});

test('topRegions sorts and trims', () => {
  const top = topRegions({ 'lower-c': 5, neck: 1, 'hip-l': 3, 'hip-r': 0 }, 2);
  eq(top.length, 2);
  eq(top[0].id, 'lower-c');
  eq(top[0].count, 5);
  eq(top[1].id, 'hip-l');
});

const isNode = typeof window === 'undefined';
if (isNode) {
  const failed = reportToConsole([s]);
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}
export default s;
