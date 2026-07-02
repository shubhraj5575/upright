// cam-session.js — PURE camera-session accounting. The impure camera shell
// feeds it (state, dt) ticks; this module accumulates a pending delta, decides
// when a poor stretch counts as a "slouch event", and merges deltas into the
// day record stored at postureCamLog[day].
//
// Day records are sums-and-counts (never averages) so partial flushes merge
// without weighting bugs: avg score = scoreSum / scoreCount, %good =
// goodMs / monitoredMs. Frames are never stored — only these aggregates.

export const SLOUCH_EVENT_MS = 4000; // a poor stretch this long counts as one event
export const MAX_TICK_MS = 5000; // clamp dt across tab-throttle gaps

export function emptyDay() {
  return {
    monitoredMs: 0, // time actively monitored with a pose (good + poor)
    goodMs: 0,
    poorMs: 0,
    awayMs: 0, // camera on, user out of frame
    slouchEvents: 0,
    worstStreakMs: 0, // longest continuous poor stretch
    scoreSum: 0,
    scoreCount: 0,
    sessions: 0,
    awayCount: 0, // times the user left the frame (auto-detected breaks)
    lastSessionEndedAt: null,
  };
}

/** Internal live-session state. Keep it opaque; mutate only via accumulate(). */
export function createSession() {
  return {
    pending: emptyDay(), // delta since the last flush
    poorStreakMs: 0, // current continuous poor stretch
    poorEventCounted: false,
    sessionCounted: false, // `sessions` increments once, on the first flush
  };
}

/**
 * Feed one tick.
 * @param {object} s        from createSession() (mutated)
 * @param {'good'|'poor'|'away'} state
 * @param {number} dtMs     elapsed since previous tick
 * @param {number|null} [score]  0..100 when a pose was scored this tick
 */
export function accumulate(s, state, dtMs, score = null) {
  const dt = Math.max(0, Math.min(dtMs, MAX_TICK_MS));
  const p = s.pending;
  if (state === 'away') {
    p.awayMs += dt;
  } else if (state === 'good' || state === 'poor') {
    p.monitoredMs += dt;
    if (state === 'good') p.goodMs += dt;
    else p.poorMs += dt;
  }

  // Poor-streak accounting: an episode is counted once it survives
  // SLOUCH_EVENT_MS; the streak keeps growing until posture recovers.
  if (state === 'poor') {
    s.poorStreakMs += dt;
    if (s.poorStreakMs >= SLOUCH_EVENT_MS && !s.poorEventCounted) {
      p.slouchEvents += 1;
      s.poorEventCounted = true;
    }
    if (s.poorStreakMs > p.worstStreakMs) p.worstStreakMs = s.poorStreakMs;
  } else {
    s.poorStreakMs = 0;
    s.poorEventCounted = false;
  }

  if (score != null && (state === 'good' || state === 'poor')) {
    p.scoreSum += score;
    p.scoreCount += 1;
  }
}

/** Record that the user left the frame (call once per transition to away). */
export function markAway(s) {
  s.pending.awayCount += 1;
  // Leaving the frame ends any poor streak.
  s.poorStreakMs = 0;
  s.poorEventCounted = false;
}

/**
 * Take the pending delta for writing and reset it (the session keeps running).
 * @param {object} s
 * @param {{ final?: boolean, endedAt?: string }} [opts]  final: session is ending
 * @returns {object|null} delta day-record, or null if there is nothing to write
 */
export function takeFlush(s, opts = {}) {
  const p = s.pending;
  const hasData = p.monitoredMs > 0 || p.awayMs > 0 || p.awayCount > 0;
  // A final flush only matters if this session ever produced data (now or in
  // an earlier flush) — otherwise a start-then-stop would write empty records.
  if (!hasData && !(opts.final && s.sessionCounted)) return null;
  const delta = { ...p };
  if (!s.sessionCounted && hasData) {
    delta.sessions = 1;
    s.sessionCounted = true;
  }
  if (opts.final && opts.endedAt) delta.lastSessionEndedAt = opts.endedAt;
  s.pending = emptyDay();
  return delta;
}

/**
 * Merge a flush delta into a stored day record (missing/legacy fields safe).
 * @param {object|undefined} day  existing postureCamLog[dayKey]
 * @param {object} delta          from takeFlush()
 */
export function mergeDay(day, delta) {
  const base = { ...emptyDay(), ...(day || {}) };
  return {
    monitoredMs: base.monitoredMs + (delta.monitoredMs || 0),
    goodMs: base.goodMs + (delta.goodMs || 0),
    poorMs: base.poorMs + (delta.poorMs || 0),
    awayMs: base.awayMs + (delta.awayMs || 0),
    slouchEvents: base.slouchEvents + (delta.slouchEvents || 0),
    worstStreakMs: Math.max(base.worstStreakMs, delta.worstStreakMs || 0),
    scoreSum: base.scoreSum + (delta.scoreSum || 0),
    scoreCount: base.scoreCount + (delta.scoreCount || 0),
    sessions: base.sessions + (delta.sessions || 0),
    awayCount: base.awayCount + (delta.awayCount || 0),
    lastSessionEndedAt: delta.lastSessionEndedAt || base.lastSessionEndedAt,
  };
}

/**
 * Friendly rollup of a stored day record for tiles/report/insights.
 * @param {object|undefined} day
 * @returns {{ monitoredMin:number, pctGood:number|null, avgScore:number|null,
 *             slouchEvents:number, sessions:number, awayCount:number,
 *             worstStreakMin:number }}
 */
export function summarizeDay(day) {
  const d = { ...emptyDay(), ...(day || {}) };
  return {
    monitoredMin: Math.round(d.monitoredMs / 60000),
    pctGood: d.monitoredMs > 0 ? Math.round((d.goodMs / d.monitoredMs) * 100) : null,
    avgScore: d.scoreCount > 0 ? Math.round(d.scoreSum / d.scoreCount) : null,
    slouchEvents: d.slouchEvents,
    sessions: d.sessions,
    awayCount: d.awayCount,
    worstStreakMin: Math.round(d.worstStreakMs / 60000),
  };
}

/**
 * Drop day keys older than `keepDays` (storage hygiene; ~180 days ≈ a course
 * of recovery). Returns the same object when nothing changes.
 */
export function pruneLog(log, todayKey, keepDays = 180, diffDaysFn) {
  if (!log || typeof log !== 'object') return log;
  const stale = Object.keys(log).filter((k) => diffDaysFn(todayKey, k) > keepDays);
  if (!stale.length) return log;
  const next = { ...log };
  for (const k of stale) delete next[k];
  return next;
}
