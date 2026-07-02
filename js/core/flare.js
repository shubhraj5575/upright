// flare.js — PURE flare-up episode logic. A flare is a bounded bad patch:
// starting one reduces daily goals, protects the logging streak, and calms
// camera alerts; ending one records how long it lasted so the history can
// show the honest, reassuring pattern — flares end.
//
// Storage shape (flareLog, array):
//   { id, startedAt ISO, startDay, endedAt ISO|null, endDay|null,
//     severity 0-10, trigger, notes }
// At most one entry has endedAt === null (the active flare).

import { addDays, diffDays } from './dates.js';

/** The red-flag guidance, shared verbatim between Settings and the flare view. */
export const RED_FLAG_TITLE = 'Seek prompt medical care if you notice';
export const RED_FLAG_BODY =
  'new numbness in the groin/saddle area, leg weakness, or any loss of bladder or bowel control. '
  + 'These can signal a serious problem and need urgent attention.';

/** The active flare entry, or null. */
export function activeFlare(flareLog) {
  return (flareLog || []).find((f) => f && !f.endedAt) || null;
}

/**
 * Start a flare. No-op (returns the same array) if one is already active.
 * @param {object[]} flareLog
 * @param {{ severity:number, trigger?:string, notes?:string, now:string, today:string }} opts
 */
export function startFlare(flareLog, opts) {
  const log = flareLog || [];
  if (activeFlare(log)) return log;
  const sev = Math.max(0, Math.min(10, Math.round(opts.severity ?? 5)));
  return [...log, {
    id: `flare-${opts.now}`,
    startedAt: opts.now,
    startDay: opts.today,
    endedAt: null,
    endDay: null,
    severity: sev,
    trigger: (opts.trigger || '').trim(),
    notes: (opts.notes || '').trim(),
  }];
}

/** End the active flare (no-op if none). */
export function endFlare(flareLog, opts) {
  const log = flareLog || [];
  if (!activeFlare(log)) return log;
  return log.map((f) => (f && !f.endedAt ? { ...f, endedAt: opts.now, endDay: opts.today } : f));
}

/** Completed flares, oldest first, each with durationDays (inclusive). */
export function completedFlares(flareLog) {
  return (flareLog || [])
    .filter((f) => f && f.endedAt && f.startDay && f.endDay)
    .map((f) => ({ ...f, durationDays: Math.max(1, diffDays(f.endDay, f.startDay) + 1) }));
}

/** How long the active flare has run so far, in days (1 = started today). */
export function activeFlareDays(flareLog, today) {
  const f = activeFlare(flareLog);
  if (!f) return 0;
  return Math.max(1, diffDays(today, f.startDay) + 1);
}

/**
 * Every day key covered by any flare (active ones run through `today`).
 * Union these with logged days so a flare never breaks a streak.
 * @returns {Set<string>}
 */
export function flareDayKeys(flareLog, today) {
  const out = new Set();
  for (const f of flareLog || []) {
    if (!f || !f.startDay) continue;
    const end = f.endDay || today;
    if (diffDays(end, f.startDay) < 0) continue;
    let cursor = f.startDay;
    // Bounded: flares are days-to-weeks; cap the walk defensively.
    for (let i = 0; i <= 366 && diffDays(end, cursor) >= 0; i++) {
      out.add(cursor);
      cursor = addDays(cursor, 1);
    }
  }
  return out;
}

/**
 * Goals adjusted for a flare. Movement targets shrink (pushing through a
 * flare is how people get hurt); hydration stays — water matters just as
 * much on bad days.
 * @param {{ waterMl:number, steps:number, waterStepMl?:number }} goals
 * @param {boolean} flareIsActive
 * @param {number} reductionPct 0–90
 */
export function adjustedGoals(goals, flareIsActive, reductionPct = 50) {
  if (!flareIsActive) return { ...goals, reduced: false };
  const pct = Math.max(0, Math.min(90, reductionPct));
  return {
    ...goals,
    steps: Math.max(500, Math.round((goals.steps || 0) * (1 - pct / 100) / 100) * 100),
    reduced: true,
    reductionPct: pct,
  };
}

/** History rollup for the "flares end" card. */
export function flareHistoryStats(flareLog) {
  const done = completedFlares(flareLog);
  if (!done.length) return null;
  const avg = done.reduce((s, f) => s + f.durationDays, 0) / done.length;
  return { count: done.length, avgDays: Math.round(avg * 10) / 10, durations: done.map((f) => f.durationDays) };
}
