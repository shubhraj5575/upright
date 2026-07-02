// body-regions.js — PURE region definitions + tallies for the pain body map.
// Nine coarse regions of the back (viewed from behind, so the person's left
// appears on the viewer's left). The SVG shapes live in modules/body-map.js;
// this file is the vocabulary and the math.

export const REGIONS = [
  { id: 'neck', label: 'Neck' },
  { id: 'shoulder-l', label: 'Left shoulder' },
  { id: 'shoulder-r', label: 'Right shoulder' },
  { id: 'mid-back', label: 'Mid back' },
  { id: 'lower-l', label: 'Lower back · left' },
  { id: 'lower-c', label: 'Lower back · centre' },
  { id: 'lower-r', label: 'Lower back · right' },
  { id: 'hip-l', label: 'Left hip / glute' },
  { id: 'hip-r', label: 'Right hip / glute' },
];

export function regionLabel(id) {
  const r = REGIONS.find((x) => x.id === id);
  return r ? r.label : id;
}

/**
 * Count, per region, how many of the given days logged pain there.
 * @param {object} painLog  day → { regions?: string[] }
 * @param {string[]} dayKeys
 * @returns {Record<string, number>}
 */
export function regionCounts(painLog, dayKeys) {
  const counts = {};
  for (const day of dayKeys || []) {
    const e = (painLog || {})[day];
    for (const id of (e && e.regions) || []) {
      counts[id] = (counts[id] || 0) + 1;
    }
  }
  return counts;
}

/** Regions sorted by frequency (most-affected first), zeroes dropped. */
export function topRegions(counts, k = 3) {
  return Object.entries(counts || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, count]) => ({ id, label: regionLabel(id), count }));
}
