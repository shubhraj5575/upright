// backup.js — first-class export/import so data is never trapped in a browser
// profile. The transforms (buildExport / parseImport / mergeDatasets) are pure
// and DOM-free so they can be unit-tested; the *ToFile / *FromFile wrappers add
// the browser download / FileReader plumbing on top.

import { KEYS, KIND, SCHEMA_VERSION, validateDataset, defaultFor } from './schema.js';
import * as store from './store.js';
import { daysAgo } from './dates.js';

export const MERGE = 'merge';
export const REPLACE = 'replace';

/** Wrap a dataset in a versioned, self-describing envelope. */
export function buildExport(data, exportedAt) {
  const normalized = {};
  for (const key of KEYS) normalized[key] = key in data ? data[key] : defaultFor(key);
  return {
    __upright: true,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: exportedAt || null,
    data: normalized,
  };
}

export function serializeExport(data, exportedAt) {
  return JSON.stringify(buildExport(data, exportedAt), null, 2);
}

/**
 * Parse + validate an import payload (text or already-parsed object). Accepts
 * either our envelope ({ __upright, data }) or a bare dataset object.
 * @returns {{ ok: boolean, data?: object, schemaVersion?: number, error?: string }}
 */
export function parseImport(input) {
  let parsed;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (_) {
      return { ok: false, error: 'File is not valid JSON.' };
    }
  } else {
    parsed = input;
  }
  if (parsed == null || typeof parsed !== 'object') {
    return { ok: false, error: 'File does not contain a backup object.' };
  }
  // Envelope or bare dataset?
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
  const { ok, errors } = validateDataset(data);
  if (!ok) {
    return { ok: false, error: 'Backup failed validation: ' + errors.join('; ') };
  }
  return { ok: true, data, schemaVersion: parsed.schemaVersion };
}

function mergeArrayById(baseArr, incomingArr) {
  const base = Array.isArray(baseArr) ? baseArr.slice() : [];
  const seen = new Set(base.map((x) => x && x.id).filter((id) => id != null));
  for (const item of Array.isArray(incomingArr) ? incomingArr : []) {
    const id = item && item.id;
    if (id == null || !seen.has(id)) {
      base.push(item);
      if (id != null) seen.add(id);
    }
  }
  return base;
}

/**
 * Produce the dataset to commit.
 *  - REPLACE: incoming wins wholesale (missing keys fall back to defaults).
 *  - MERGE:   additive — LOCAL (`base`) always wins on collision; incoming only
 *             contributes entries/fields/ids that local is missing. This can
 *             never clobber a newer local entry with an older backup; full
 *             overwrite is what Replace is for.
 */
export function mergeDatasets(base, incoming, mode) {
  const out = {};
  for (const key of KEYS) {
    const b = base && key in base ? base[key] : defaultFor(key);
    const inc = incoming && key in incoming ? incoming[key] : undefined;

    if (mode === REPLACE) {
      out[key] = inc !== undefined ? inc : defaultFor(key);
      continue;
    }
    // MERGE (additive, local wins)
    if (inc === undefined) {
      out[key] = b;
    } else if (KIND[key] === 'array') {
      out[key] = mergeArrayById(b, inc);
    } else {
      // 'map' and 'object': spread incoming first, then local, so local wins
      // on key/field collisions and incoming only fills the gaps.
      out[key] = { ...(inc || {}), ...(b || {}) };
    }
  }
  return out;
}

// --- browser wrappers ----------------------------------------------------

function timestamp(d = new Date()) {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Export the live dataset to a downloaded JSON file; records last-backup time. */
export function exportToFile() {
  const nowIso = new Date().toISOString();
  // Record the backup time *before* snapshotting so the file documents itself.
  store.update('meta', (m) => ({ ...m, lastBackupAt: nowIso }));
  const text = serializeExport(store.all(), nowIso);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `upright-backup-${timestamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true, at: nowIso };
}

/**
 * Read a File, validate, and commit using the chosen mode. Returns a promise
 * resolving to { ok, error? } — callers surface the message via a toast.
 */
export function importFromFile(file, mode = MERGE) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, error: 'Could not read the file.' });
    reader.onload = () => {
      const result = parseImport(String(reader.result));
      if (!result.ok) return resolve(result);
      const merged = mergeDatasets(store.all(), result.data, mode);
      store.replaceAll(merged);
      resolve({ ok: true });
    };
    reader.readAsText(file);
  });
}

/** For the Settings "last backup N days ago" nudge. */
export function lastBackupInfo() {
  const meta = store.get('meta');
  const at = meta && meta.lastBackupAt ? meta.lastBackupAt : null;
  if (!at) return { at: null, days: null };
  let days = null;
  try {
    const key = at.slice(0, 10); // ISO date portion
    days = daysAgo(key);
  } catch (_) {
    /* leave null */
  }
  return { at, days };
}
