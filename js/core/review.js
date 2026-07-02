// review.js — PURE weekly review. Once a week (Monday-based), compare last
// week against the week before: a handful of honest deltas, exactly one win
// and one focus, both chosen by deterministic priority lists so the copy
// never overclaims. A flare week overrides the win: showing up was the win.

import { addDays, diffDays, parseKey, toKey } from './dates.js';
import { flareDayKeys } from './flare.js';

/** Monday of the week containing `key`. */
export function weekStartKey(key) {
  const d = parseKey(key);
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  return toKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow));
}

const mean = (vals) => {
  const real = vals.filter((v) => v != null);
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null;
};
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * Aggregate one Monday-started week from the dataset.
 * @param {object} data  { painLog, goalsLog, exerciseLog, sleepLog, postureCamLog, postureSelfLog, flareLog, settings }
 * @param {string} weekStart  Monday key
 */
export function summarizeWeek(data, weekStart) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const painLog = data.painLog || {};
  const goalsLog = data.goalsLog || {};
  const exLog = data.exerciseLog || {};
  const sleepLog = data.sleepLog || {};
  const camLog = data.postureCamLog || {};
  const postureLog = data.postureSelfLog || {};
  const goals = ((data.settings || {}).goals) || { waterMl: 2000, steps: 6000 };
  const flareDays = flareDayKeys(data.flareLog || [], days[6]);

  let loggedDays = 0;
  const pains = [], stiffs = [], sleeps = [];
  let exerciseDays = 0, waterMetDays = 0, stepMetDays = 0, postureChecks = 0, flareDayCount = 0;
  let camGood = 0, camMonitored = 0;

  for (const k of days) {
    const p = painLog[k];
    const g = goalsLog[k] || {};
    const anyLog = (p && typeof p.pain === 'number') || (g.waterMl || 0) > 0 || (g.steps || 0) > 0
      || (exLog[k] || []).length || (postureLog[k] || []).length || sleepLog[k];
    if (anyLog) loggedDays++;
    if (p && typeof p.pain === 'number') { pains.push(p.pain); stiffs.push(p.stiffness); }
    if ((exLog[k] || []).length) exerciseDays++;
    if ((g.waterMl || 0) >= goals.waterMl) waterMetDays++;
    if ((g.steps || 0) >= goals.steps) stepMetDays++;
    postureChecks += (postureLog[k] || []).length;
    if (sleepLog[k] && typeof sleepLog[k].hours === 'number') sleeps.push(sleepLog[k].hours);
    const cam = camLog[k];
    if (cam && cam.monitoredMs > 0) { camGood += cam.goodMs || 0; camMonitored += cam.monitoredMs; }
    if (flareDays.has(k)) flareDayCount++;
  }

  return {
    weekStart,
    loggedDays,
    painDays: pains.length,
    avgPain: round1(mean(pains)),
    avgStiffness: round1(mean(stiffs)),
    exerciseDays,
    waterMetDays,
    stepMetDays,
    postureChecks,
    avgSleep: round1(mean(sleeps)),
    sleepDays: sleeps.length,
    camPctGood: camMonitored > 0 ? Math.round((camGood / camMonitored) * 100) : null,
    flareDayCount,
  };
}

/**
 * Is a review pending for the user to see?
 * Ready when: we're in a NEW week vs lastReviewWeekSeen, and LAST week had
 * at least 3 logged days (else there is nothing honest to review).
 */
export function isReviewReady(data, today, lastReviewWeekSeen) {
  const thisWeek = weekStartKey(today);
  const lastWeek = addDays(thisWeek, -7);
  if (lastReviewWeekSeen === lastWeek) return { ready: false, weekKey: lastWeek };
  const sum = summarizeWeek(data, lastWeek);
  return { ready: sum.loggedDays >= 3, weekKey: lastWeek };
}

function pickWin(cur, prev) {
  if (cur.flareDayCount > 0) {
    return `A flare week — and you still logged ${cur.loggedDays} day${cur.loggedDays === 1 ? '' : 's'}. Keeping the habit alive through a flare is the win.`;
  }
  if (cur.avgPain != null && prev.avgPain != null && prev.avgPain - cur.avgPain >= 0.7) {
    return `Pain eased: it averaged ${cur.avgPain}/10 across ${cur.painDays} logged days, down from ${prev.avgPain}/10 the week before.`;
  }
  if (cur.exerciseDays >= prev.exerciseDays + 2) {
    return `You exercised on ${cur.exerciseDays} days — up from ${prev.exerciseDays} the week before.`;
  }
  if (cur.stepMetDays >= prev.stepMetDays + 2) {
    return `You hit your step goal on ${cur.stepMetDays} days — up from ${prev.stepMetDays}.`;
  }
  if (cur.avgSleep != null && prev.avgSleep != null && cur.avgSleep - prev.avgSleep >= 0.5) {
    return `You slept ${cur.avgSleep}h on average — about ${round1(cur.avgSleep - prev.avgSleep)}h more than the week before.`;
  }
  if (cur.camPctGood != null && prev.camPctGood != null && cur.camPctGood - prev.camPctGood >= 8) {
    return `Camera-measured posture improved: ${cur.camPctGood}% good time, up from ${prev.camPctGood}%.`;
  }
  if (cur.loggedDays >= 5) {
    return `You showed up: logged ${cur.loggedDays} of 7 days. Consistency is what makes the trends trustworthy.`;
  }
  return 'You kept logging. That habit is the foundation everything else builds on.';
}

function pickFocus(cur) {
  if (cur.flareDayCount > 0) {
    return 'Be gentle with yourself: goals stay reduced while the flare lasts. Short, easy walks and your physio’s flare advice come first.';
  }
  if (cur.sleepDays >= 3 && cur.avgSleep != null && cur.avgSleep < 6.5) {
    return `Sleep averaged ${cur.avgSleep}h. Backs recover at night — try protecting a 7h window this week.`;
  }
  if (cur.stepMetDays <= 2) {
    return `The step goal landed on ${cur.stepMetDays} of 7 days. A short walk after meals is the easiest way to add gentle movement.`;
  }
  if (cur.exerciseDays <= 2) {
    return `Exercises happened on ${cur.exerciseDays} days. Even one set counts — pairing them with a fixed daily moment helps.`;
  }
  if (cur.waterMetDays <= 2) {
    return `Water goal met on ${cur.waterMetDays} of 7 days. Keeping a full bottle at your desk usually fixes this one.`;
  }
  if (cur.postureChecks < 5 && cur.camPctGood == null) {
    return 'Few posture check-ins last week. A couple of honest taps a day (or a camera session) sharpens the picture.';
  }
  return 'No obvious gap — keep the same rhythm going this week.';
}

/**
 * The full review object for LAST week (relative to `today`).
 */
export function buildWeeklyReview(data, today) {
  const thisWeek = weekStartKey(today);
  const lastWeek = addDays(thisWeek, -7);
  const prevWeek = addDays(thisWeek, -14);
  const cur = summarizeWeek(data, lastWeek);
  const prev = summarizeWeek(data, prevWeek);

  const deltas = [];
  const push = (label, curV, prevV, fmt = (v) => v, lowerBetter = false) => {
    if (curV == null) return;
    const d = { label, current: fmt(curV), previous: prevV == null ? null : fmt(prevV) };
    if (prevV != null && curV !== prevV) {
      d.dir = curV > prevV ? 'up' : 'down';
      d.good = lowerBetter ? curV < prevV : curV > prevV;
    }
    deltas.push(d);
  };
  push('Avg pain', cur.avgPain, prev.avgPain, (v) => `${v}/10`, true);
  push('Exercise days', cur.exerciseDays, prev.exerciseDays);
  push('Step-goal days', cur.stepMetDays, prev.stepMetDays);
  push('Water-goal days', cur.waterMetDays, prev.waterMetDays);
  if (cur.avgSleep != null) push('Avg sleep', cur.avgSleep, prev.avgSleep, (v) => `${v}h`);
  if (cur.camPctGood != null) push('Camera posture', cur.camPctGood, prev.camPctGood, (v) => `${v}%`);

  return {
    weekKey: lastWeek,
    flareWeek: cur.flareDayCount > 0,
    current: cur,
    previous: prev,
    deltas,
    win: pickWin(cur, prev),
    focus: pickFocus(cur),
  };
}
