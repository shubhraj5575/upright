// insights.js — PURE rule-based pattern spotting across the user's own logs.
//
// Statistical honesty is the design constraint, encoded as tests:
//  - a comparison only unlocks with ≥ MIN_N days on EACH side;
//  - every unlocked comparison states both sample sizes in its text;
//  - wording is observational ("averaged", "tended to be") — never causal;
//  - differences below MIN_DELTA are reported as "no clear difference" and
//    never ranked into the top slots;
//  - pain/stiffness comparisons EXCLUDE flare days (a flare would swamp any
//    pattern) and say so when days were excluded;
//  - locked rules explain exactly what to log and how much more of it.

import { addDays, diffDays } from './dates.js';
import { flareDayKeys } from './flare.js';
import { dailyTotals } from './nutrition.js';

export const MIN_N = 5;
export const MIN_DELTA_SCORE = 0.7; // pain/stiffness on the 0–10 scale
export const MIN_DELTA_PCT = 8; // percentage-point comparisons
const WINDOW_DAYS = 60; // how far back rules look

// --- tiny stats helpers -------------------------------------------------------

const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
const round1 = (v) => Math.round(v * 10) / 10;

/** Last `days` day-keys ending today, oldest first. */
export function windowKeys(today, days = WINDOW_DAYS) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(addDays(today, -i));
  return keys;
}

/**
 * Split day values into two labelled groups and compare their means.
 * @param {{day:string, split:'a'|'b'|null, value:number|null}[]} rows
 * @returns {{ unlocked:boolean, a:{n:number,mean:number|null}, b:{n:number,mean:number|null}, delta:number|null }}
 */
export function compareDays(rows, minN = MIN_N) {
  const aVals = rows.filter((r) => r.split === 'a' && r.value != null).map((r) => r.value);
  const bVals = rows.filter((r) => r.split === 'b' && r.value != null).map((r) => r.value);
  const a = { n: aVals.length, mean: mean(aVals) };
  const b = { n: bVals.length, mean: mean(bVals) };
  const unlocked = a.n >= minN && b.n >= minN;
  return { unlocked, a, b, delta: unlocked ? a.mean - b.mean : null };
}

/** 'strong' | 'moderate' | 'weak' for a delta given the meaningful threshold. */
export function strengthOf(absDelta, minDelta) {
  if (absDelta >= minDelta * 2) return 'strong';
  if (absDelta >= minDelta) return 'moderate';
  return 'weak';
}

/** Time-of-day bucket for an ISO timestamp. */
export function daypart(iso) {
  const h = new Date(iso).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const moreDays = (n) => `${n} more day${n === 1 ? '' : 's'}`;

/**
 * Build a comparison-style result object (the common case).
 * Neutral (below-threshold) results get direction 'none' and never rank.
 */
function comparisonResult({ id, group, cmp, minDelta, textFor, neutralText, flaggedExclusions }) {
  const absDelta = Math.abs(cmp.delta);
  const note = flaggedExclusions ? ' Flare days excluded.' : '';
  if (absDelta < minDelta) {
    return {
      id, group, unlocked: true, direction: 'none', strength: 'weak',
      text: `${neutralText} (${plural(cmp.a.n, 'day')} vs ${plural(cmp.b.n, 'day')} — no clear difference so far.)${note}`,
    };
  }
  return {
    id, group, unlocked: true,
    direction: cmp.delta > 0 ? 'higher' : 'lower',
    strength: strengthOf(absDelta, minDelta),
    text: textFor(cmp) + note,
  };
}

function lockedResult(id, group, lockedText, remaining = null) {
  return { id, group, unlocked: false, lockedText, remaining };
}

// --- data plumbing ------------------------------------------------------------

/**
 * Pre-index the dataset once for all rules.
 * @param {object} data  raw store logs + settings
 * @param {string} today
 */
function buildCtx(data, today) {
  const keys = windowKeys(today);
  const flareDays = flareDayKeys(data.flareLog || [], today);
  const goals = ((data.settings || {}).goals) || { waterMl: 2000, steps: 6000 };
  const nutritionTargets = ((data.settings || {}).nutrition || {}).targets || {};
  return { data, today, keys, flareDays, goals, nutritionTargets };
}

/** pain/stiffness value for a day, excluding flare days (returns null). */
function scoreOn(ctx, day, field) {
  if (ctx.flareDays.has(day)) return null;
  const e = (ctx.data.painLog || {})[day];
  return e && typeof e[field] === 'number' ? e[field] : null;
}
function anyFlareOverlap(ctx, rows) {
  return rows.some((r) => r.split && ctx.flareDays.has(r.day));
}

// --- the rules ------------------------------------------------------------------
// Each returns a result object or null (not applicable / nothing to say yet).

function ruleSleepStiffness(ctx) {
  const sleepLog = ctx.data.sleepLog || {};
  const rows = ctx.keys.map((day) => {
    const s = sleepLog[day];
    const split = s && typeof s.hours === 'number' ? (s.hours < 6.5 ? 'a' : s.hours >= 7 ? 'b' : null) : null;
    return { day, split, value: split ? scoreOn(ctx, day, 'stiffness') : null };
  });
  const cmp = compareDays(rows);
  if (!cmp.unlocked) {
    const have = rows.filter((r) => r.value != null && r.split).length;
    return lockedResult('sleep-stiffness', 'sleep',
      `Log sleep and stiffness together on ${moreDays(Math.max(1, MIN_N * 2 - have))} to see whether short nights show up in your back.`);
  }
  return comparisonResult({
    id: 'sleep-stiffness', group: 'sleep', cmp, minDelta: MIN_DELTA_SCORE,
    flaggedExclusions: (ctx.data.flareLog || []).length > 0,
    neutralText: 'Stiffness after short nights (<6.5h) looks about the same as after 7h+ nights',
    textFor: (c) => `After nights under 6.5h your stiffness averaged ${round1(c.a.mean)}/10 (${plural(c.a.n, 'day')}), vs ${round1(c.b.mean)}/10 after 7h+ nights (${plural(c.b.n, 'day')}).`,
  });
}

function ruleSleepQualityPain(ctx) {
  const sleepLog = ctx.data.sleepLog || {};
  const rows = ctx.keys.map((day) => {
    const s = sleepLog[day];
    const split = s && typeof s.quality === 'number' ? (s.quality <= 2 ? 'a' : s.quality >= 4 ? 'b' : null) : null;
    return { day, split, value: split ? scoreOn(ctx, day, 'pain') : null };
  });
  const cmp = compareDays(rows);
  if (!cmp.unlocked) {
    return lockedResult('sleep-quality-pain', 'sleep',
      'Keep rating sleep quality alongside pain — once you have 5 rough-sleep days and 5 good-sleep days, this comparison unlocks.');
  }
  return comparisonResult({
    id: 'sleep-quality-pain', group: 'sleep', cmp, minDelta: MIN_DELTA_SCORE,
    flaggedExclusions: (ctx.data.flareLog || []).length > 0,
    neutralText: 'Pain on days after rough sleep looks about the same as after restful sleep',
    textFor: (c) => `On days after rough sleep (quality 1–2) your pain averaged ${round1(c.a.mean)}/10 (${plural(c.a.n, 'day')}), vs ${round1(c.b.mean)}/10 after restful sleep (${plural(c.b.n, 'day')}).`,
  });
}

function ruleSleepPositionStiff(ctx) {
  const sleepLog = ctx.data.sleepLog || {};
  const byPos = {};
  for (const day of ctx.keys) {
    const s = sleepLog[day];
    if (!s || !s.position || typeof s.wokeStiff !== 'boolean') continue;
    (byPos[s.position] = byPos[s.position] || []).push(s.wokeStiff ? 1 : 0);
  }
  const eligible = Object.entries(byPos).filter(([, v]) => v.length >= MIN_N);
  if (eligible.length < 2) {
    return lockedResult('sleep-position', 'sleep',
      `Log your sleep position (and whether you woke stiff) — ${MIN_N} nights in each of two positions unlocks this comparison.`);
  }
  const rates = eligible.map(([pos, v]) => ({ pos, n: v.length, rate: Math.round(mean(v) * 100) }))
    .sort((x, y) => x.rate - y.rate);
  const best = rates[0], worst = rates[rates.length - 1];
  if (worst.rate - best.rate < MIN_DELTA_PCT) {
    return {
      id: 'sleep-position', group: 'sleep', unlocked: true, direction: 'none', strength: 'weak',
      text: `Waking up stiff looks similar across sleep positions so far (${rates.map((r) => `${r.pos}: ${r.rate}% of ${plural(r.n, 'night')}`).join(', ')}).`,
    };
  }
  return {
    id: 'sleep-position', group: 'sleep', unlocked: true, direction: 'lower',
    strength: strengthOf(worst.rate - best.rate, MIN_DELTA_PCT),
    text: `You woke up stiff after ${best.rate}% of ${best.pos}-sleeping nights (${plural(best.n, 'night')}), vs ${worst.rate}% after ${worst.pos}-sleeping nights (${plural(worst.n, 'night')}).`,
  };
}

function stepsSplit(ctx, day) {
  const g = (ctx.data.goalsLog || {})[day];
  if (!g || !(g.steps > 0)) return null;
  if (g.steps >= ctx.goals.steps) return 'a';
  if (g.steps < ctx.goals.steps * 0.5) return 'b';
  return null;
}

function ruleStepsSameDay(ctx) {
  const rows = ctx.keys.map((day) => {
    const split = stepsSplit(ctx, day);
    return { day, split, value: split ? scoreOn(ctx, day, 'pain') : null };
  });
  const cmp = compareDays(rows);
  if (!cmp.unlocked) {
    return lockedResult('steps-same-day', 'movement',
      'Log steps and pain on the same days — 5 active days and 5 quiet days unlock this comparison.');
  }
  return comparisonResult({
    id: 'steps-same-day', group: 'movement', cmp, minDelta: MIN_DELTA_SCORE,
    flaggedExclusions: (ctx.data.flareLog || []).length > 0,
    neutralText: 'Pain on goal-hitting step days looks about the same as on quiet days',
    textFor: (c) => `On days you hit your step goal, pain averaged ${round1(c.a.mean)}/10 (${plural(c.a.n, 'day')}), vs ${round1(c.b.mean)}/10 on quiet days (${plural(c.b.n, 'day')}).`,
  });
}

function ruleStepsNextDay(ctx) {
  const rows = ctx.keys.slice(0, -1).map((day, i) => {
    const split = stepsSplit(ctx, day);
    const next = ctx.keys[i + 1];
    return { day: next, split, value: split ? scoreOn(ctx, next, 'pain') : null };
  });
  const cmp = compareDays(rows);
  if (!cmp.unlocked) {
    return lockedResult('steps-next-day', 'movement',
      'This one needs a longer streak of step + pain logging — it compares how you feel the day AFTER active vs quiet days.');
  }
  return comparisonResult({
    id: 'steps-next-day', group: 'movement', cmp, minDelta: MIN_DELTA_SCORE,
    flaggedExclusions: (ctx.data.flareLog || []).length > 0,
    neutralText: 'Next-day pain after active days looks about the same as after quiet days',
    textFor: (c) => `The day after hitting your step goal, pain averaged ${round1(c.a.mean)}/10 (${plural(c.a.n, 'day')}), vs ${round1(c.b.mean)}/10 the day after quiet days (${plural(c.b.n, 'day')}).`,
  });
}

function ruleExerciseNextDay(ctx) {
  const exLog = ctx.data.exerciseLog || {};
  const rows = ctx.keys.slice(0, -1).map((day, i) => {
    const did = (exLog[day] || []).length > 0;
    const logged = exLog[day] !== undefined || (ctx.data.painLog || {})[day];
    const split = did ? 'a' : logged ? 'b' : null;
    const next = ctx.keys[i + 1];
    return { day: next, split, value: split ? scoreOn(ctx, next, 'stiffness') : null };
  });
  const cmp = compareDays(rows);
  if (!cmp.unlocked) {
    return lockedResult('exercise-next-day', 'movement',
      'Mark exercises done and keep logging stiffness — 5 exercise days and 5 rest days unlock the next-morning comparison.');
  }
  return comparisonResult({
    id: 'exercise-next-day', group: 'movement', cmp, minDelta: MIN_DELTA_SCORE,
    flaggedExclusions: (ctx.data.flareLog || []).length > 0,
    neutralText: 'Next-day stiffness after exercise days looks about the same as after rest days',
    textFor: (c) => `The day after doing your exercises, stiffness averaged ${round1(c.a.mean)}/10 (${plural(c.a.n, 'day')}), vs ${round1(c.b.mean)}/10 after days without them (${plural(c.b.n, 'day')}).`,
  });
}

function ruleExerciseWeeks(ctx) {
  const exLog = ctx.data.exerciseLog || {};
  const painLog = ctx.data.painLog || {};
  // Group window into whole weeks (oldest first), needing pain data in each.
  const weeks = [];
  for (let w = 0; w + 7 <= ctx.keys.length; w += 7) {
    const days = ctx.keys.slice(w, w + 7);
    const exDays = days.filter((d) => (exLog[d] || []).length > 0).length;
    const pains = days.map((d) => scoreOn(ctx, d, 'pain')).filter((v) => v != null);
    if (pains.length >= 3) weeks.push({ exDays, avgPain: mean(pains) });
  }
  const active = weeks.filter((w) => w.exDays >= 3);
  const light = weeks.filter((w) => w.exDays < 3);
  if (active.length < 2 || light.length < 2) {
    return lockedResult('exercise-weeks', 'movement',
      'Keep marking exercises done — after a few more weeks, Upright can compare consistent weeks against light ones.');
  }
  const a = { n: active.length, mean: mean(active.map((w) => w.avgPain)) };
  const b = { n: light.length, mean: mean(light.map((w) => w.avgPain)) };
  const delta = a.mean - b.mean;
  if (Math.abs(delta) < MIN_DELTA_SCORE) {
    return {
      id: 'exercise-weeks', group: 'movement', unlocked: true, direction: 'none', strength: 'weak',
      text: `Weekly pain looks similar between consistent-exercise weeks (${plural(a.n, 'week')}) and lighter weeks (${plural(b.n, 'week')}) so far.`,
    };
  }
  return {
    id: 'exercise-weeks', group: 'movement', unlocked: true,
    direction: delta > 0 ? 'higher' : 'lower', strength: strengthOf(Math.abs(delta), MIN_DELTA_SCORE),
    text: `In weeks with 3+ exercise days (${plural(a.n, 'week')}), pain averaged ${round1(a.mean)}/10, vs ${round1(b.mean)}/10 in lighter weeks (${plural(b.n, 'week')}).`,
  };
}

function rulePostureWorstHours(ctx) {
  const postureLog = ctx.data.postureSelfLog || {};
  const buckets = { morning: 0, afternoon: 0, evening: 0 };
  let slumps = 0, total = 0;
  for (const day of ctx.keys) {
    for (const e of postureLog[day] || []) {
      total++;
      if (e.rating <= 2) { slumps++; buckets[daypart(e.t)]++; }
    }
  }
  if (slumps < MIN_N || total < MIN_N * 2) {
    return lockedResult('posture-hours', 'posture',
      'Keep tapping honest posture check-ins — once a handful of “slumped” moments are logged, Upright can spot when in the day they cluster.');
  }
  const worst = Object.entries(buckets).sort((x, y) => y[1] - x[1])[0];
  const share = Math.round((worst[1] / slumps) * 100);
  if (share < 45) {
    return {
      id: 'posture-hours', group: 'posture', unlocked: true, direction: 'none', strength: 'weak',
      text: `Your slumped check-ins (${plural(slumps, 'entry')} of ${total}) are spread across the day — no single danger zone so far.`,
    };
  }
  return {
    id: 'posture-hours', group: 'posture', unlocked: true, direction: 'higher',
    strength: share >= 60 ? 'strong' : 'moderate',
    text: `${share}% of your slumped check-ins (${worst[1]} of ${slumps}) land in the ${worst[0]} — that’s the slot where a reminder or camera session earns its keep.`,
  };
}

function ruleCamTrend(ctx) {
  const camLog = ctx.data.postureCamLog || {};
  const half = (keys) => {
    const days = keys.map((k) => camLog[k]).filter((d) => d && d.monitoredMs > 0);
    if (days.length < 3) return null;
    const good = days.reduce((s, d) => s + (d.goodMs || 0), 0);
    const mon = days.reduce((s, d) => s + d.monitoredMs, 0);
    return { n: days.length, pct: Math.round((good / mon) * 100) };
  };
  const recent = half(ctx.keys.slice(-7));
  const prior = half(ctx.keys.slice(-14, -7));
  if (!recent || !prior) {
    return lockedResult('cam-trend', 'posture',
      'Use the camera monitor on 3+ days in back-to-back weeks to see whether your measured posture is trending better.');
  }
  const delta = recent.pct - prior.pct;
  if (Math.abs(delta) < MIN_DELTA_PCT) {
    return {
      id: 'cam-trend', group: 'posture', unlocked: true, direction: 'none', strength: 'weak',
      text: `Camera-measured posture held steady: ${recent.pct}% good this week (${plural(recent.n, 'day')}) vs ${prior.pct}% the week before (${plural(prior.n, 'day')}).`,
    };
  }
  return {
    id: 'cam-trend', group: 'posture', unlocked: true,
    direction: delta > 0 ? 'higher' : 'lower', strength: strengthOf(Math.abs(delta), MIN_DELTA_PCT),
    text: `Camera-measured good-posture time was ${recent.pct}% this week (${plural(recent.n, 'day')}), vs ${prior.pct}% the week before (${plural(prior.n, 'day')}).`,
  };
}

function adherenceRule(id, label, field, goalOf) {
  return (ctx) => {
    const goalsLog = ctx.data.goalsLog || {};
    const days = ctx.keys.slice(-14);
    const logged = days.filter((d) => goalsLog[d] && (goalsLog[d][field] || 0) > 0);
    if (logged.length < MIN_N) {
      return lockedResult(id, 'habits', `Log ${label} on ${moreDays(MIN_N - logged.length)} (of the last 14) to see your adherence pattern.`);
    }
    const met = logged.filter((d) => (goalsLog[d][field] || 0) >= goalOf(ctx)).length;
    const pct = Math.round((met / logged.length) * 100);
    return {
      id, group: 'habits', unlocked: true, direction: 'none',
      strength: pct >= 70 ? 'moderate' : 'weak',
      text: `Over the last two weeks you met your ${label} goal on ${met} of the ${plural(logged.length, 'logged day')} (${pct}%).`,
    };
  };
}
const ruleWaterAdherence = adherenceRule('water-adherence', 'water', 'waterMl', (ctx) => ctx.goals.waterMl);
const ruleStepAdherence = adherenceRule('step-adherence', 'step', 'steps', (ctx) => ctx.goals.steps);

function ruleMoodPain(ctx) {
  const painLog = ctx.data.painLog || {};
  const rows = ctx.keys.map((day) => {
    const e = painLog[day];
    const split = e && typeof e.mood === 'number' ? (e.mood <= 2 ? 'a' : e.mood >= 4 ? 'b' : null) : null;
    return { day, split, value: split ? scoreOn(ctx, day, 'pain') : null };
  });
  const cmp = compareDays(rows);
  if (!cmp.unlocked) {
    return lockedResult('mood-pain', 'habits',
      'Keep sliding the optional mood rating when logging pain — 5 low-mood and 5 good-mood days unlock this view.');
  }
  return comparisonResult({
    id: 'mood-pain', group: 'habits', cmp, minDelta: MIN_DELTA_SCORE,
    flaggedExclusions: (ctx.data.flareLog || []).length > 0,
    neutralText: 'Pain on low-mood days looks about the same as on good-mood days',
    textFor: (c) => `On low-mood days your pain averaged ${round1(c.a.mean)}/10 (${plural(c.a.n, 'day')}), vs ${round1(c.b.mean)}/10 on good-mood days (${plural(c.b.n, 'day')}) — mood and pain often travel together.`,
  });
}

function ruleFlareRecovery(ctx) {
  const done = (ctx.data.flareLog || []).filter((f) => f && f.endedAt);
  if (done.length < 2) return null; // nothing to say (and nothing to tease)
  const durations = done.map((f) => {
    if (!f.startDay || !f.endDay) return null;
    return Math.max(1, diffDays(f.endDay, f.startDay) + 1);
  }).filter(Boolean);
  const avg = round1(mean(durations));
  return {
    id: 'flare-recovery', group: 'habits', unlocked: true, direction: 'lower', strength: 'moderate',
    text: `All ${done.length} of your recorded flare-ups ended, lasting ${avg} days on average. Worth remembering mid-flare: they end.`,
  };
}

function ruleBreaksStiffness(ctx) {
  const actLog = ctx.data.activityLog || {};
  const rows = ctx.keys.map((day) => {
    const a = actLog[day];
    const split = a && typeof a.breaks === 'number' ? (a.breaks >= 4 ? 'a' : a.breaks <= 1 ? 'b' : null) : null;
    return { day, split, value: split ? scoreOn(ctx, day, 'stiffness') : null };
  });
  const cmp = compareDays(rows);
  if (!cmp.unlocked) {
    return lockedResult('breaks-stiffness', 'habits',
      'Once you start logging sitting breaks, 5 break-rich days and 5 break-poor days unlock this comparison.');
  }
  return comparisonResult({
    id: 'breaks-stiffness', group: 'habits', cmp, minDelta: MIN_DELTA_SCORE,
    flaggedExclusions: (ctx.data.flareLog || []).length > 0,
    neutralText: 'Stiffness on break-rich days looks about the same as on break-poor days',
    textFor: (c) => `On days with 4+ sitting breaks, stiffness averaged ${round1(c.a.mean)}/10 (${plural(c.a.n, 'day')}), vs ${round1(c.b.mean)}/10 on days with almost none (${plural(c.b.n, 'day')}).`,
  });
}

/** A day's logged protein grams, or null if no nutrient-bearing entry that day. */
function proteinOn(ctx, day) {
  const entries = (ctx.data.mealLog || {})[day] || [];
  if (!entries.some((e) => e.nutrients)) return null;
  return dailyTotals(entries).protein_g;
}

function ruleProteinStiffness(ctx) {
  const target = ctx.nutritionTargets.protein_g;
  const rows = ctx.keys.map((day) => {
    const p = proteinOn(ctx, day);
    const split = (target > 0 && p != null) ? (p >= target ? 'a' : p < target * 0.6 ? 'b' : null) : null;
    return { day, split, value: split ? scoreOn(ctx, day, 'stiffness') : null };
  });
  const cmp = compareDays(rows);
  if (!cmp.unlocked) {
    return lockedResult('protein-stiffness', 'habits',
      'Log your food (with nutrients) and daily stiffness together — 5 protein-target-met days and 5 lower-protein days unlock this comparison.');
  }
  return comparisonResult({
    id: 'protein-stiffness', group: 'habits', cmp, minDelta: MIN_DELTA_SCORE,
    flaggedExclusions: (ctx.data.flareLog || []).length > 0,
    neutralText: 'Stiffness on days you met your protein target looks about the same as on lower-protein days',
    textFor: (c) => `On days you met your protein target, stiffness averaged ${round1(c.a.mean)}/10 (${plural(c.a.n, 'day')}), vs ${round1(c.b.mean)}/10 on lower-protein days (${plural(c.b.n, 'day')}).`,
  });
}

function ruleFiberIntake(ctx) {
  const target = ctx.nutritionTargets.fiber_g;
  const days = ctx.keys.slice(-14).filter((d) => ((ctx.data.mealLog || {})[d] || []).some((e) => e.nutrients));
  if (!(target > 0) || days.length < MIN_N) {
    return lockedResult('fiber-intake', 'habits',
      'Log a few days of food with nutrients — once you have 5 logged-food days in the last two weeks, Upright can show how often you hit your fiber target.');
  }
  const met = days.filter((d) => dailyTotals((ctx.data.mealLog || {})[d]).fiber_g >= target).length;
  const pct = Math.round((met / days.length) * 100);
  return {
    id: 'fiber-intake', group: 'habits', unlocked: true, direction: 'none',
    strength: pct >= 70 ? 'moderate' : 'weak',
    text: `Over your logged-food days in the last two weeks, you hit your fiber target on ${met} of ${plural(days.length, 'day')} (${pct}%).`,
  };
}

const RULES = [
  ruleSleepStiffness,
  ruleSleepQualityPain,
  ruleSleepPositionStiff,
  ruleStepsSameDay,
  ruleStepsNextDay,
  ruleExerciseNextDay,
  ruleExerciseWeeks,
  rulePostureWorstHours,
  ruleCamTrend,
  ruleWaterAdherence,
  ruleStepAdherence,
  ruleMoodPain,
  ruleFlareRecovery,
  ruleBreaksStiffness,
  ruleProteinStiffness,
  ruleFiberIntake,
];

export const GROUPS = [
  { id: 'sleep', label: 'Sleep' },
  { id: 'movement', label: 'Movement' },
  { id: 'posture', label: 'Posture' },
  { id: 'habits', label: 'Habits & mood' },
];

/**
 * Run every rule.
 * @returns {{ all:object[], unlocked:object[], locked:object[], top:object[] }}
 */
export function buildInsights(data, today, topK = 3) {
  const ctx = buildCtx(data, today);
  const all = RULES.map((rule) => {
    try { return rule(ctx); } catch (_) { return null; }
  }).filter(Boolean);
  const unlocked = all.filter((r) => r.unlocked);
  const locked = all.filter((r) => !r.unlocked);
  const rank = { strong: 3, moderate: 2, weak: 1 };
  const top = unlocked
    .filter((r) => r.direction !== 'none')
    .sort((x, y) => (rank[y.strength] || 0) - (rank[x.strength] || 0))
    .slice(0, topK);
  return { all, unlocked, locked, top };
}
