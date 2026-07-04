# Upright — Back-Recovery & Posture Companion

A private, **local-first** web app to support recovery from a lower-back injury.
Everything runs in your browser; all data stays on your device. No login, no
server, no accounts. Works offline and can be installed as an app.

**Live:** <https://shubhraj5575.github.io/upright/> (auto-deploys from `main`
via GitHub Pages). Only the app code is hosted — your logs never leave your
browser.

> **Upright is a wellness tool, not medical advice.** It complements the plan
> your physiotherapist or doctor gave you — it does not replace it. Always
> follow their specific instructions.
>
> **Seek prompt medical care** if you notice new numbness in the groin/saddle
> area, leg weakness, or any loss of bladder or bowel control.

## Running it

A tiny local server is required (browser ES modules and the webcam need a
`localhost` secure context, so opening the file directly won't work).

**Easiest — double-click `start.command`.** It picks a free port, serves the
folder, and opens your browser. Keep the window open while you use the app, and
pin the browser tab so reminders can fire.

**Manual:**

```sh
cd "path/to/this/folder"
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome.

### Install as an app (optional)
In Chrome, use the install icon in the address bar (or ⋮ → “Install Upright”).
After the first visit it works offline.

## Features (v2)

- **Dashboard** — greeting + streak chip, a hero Today card (pain metric +
  compact water/steps rings), quick log, and stat tiles with sparklines for
  pain trend, posture, exercises, meals, sleep and camera sessions. Surfaces
  your top insights, the weekly-review prompt, and a flare banner when one is
  active.
- **Pain & symptoms** — daily pain/stiffness/mood sliders with anchors, a
  tappable **body map** (“where does it hurt?”, nine back regions), notes;
  interactive trend chart with 1w/4w/12w ranges and a 7-day rolling average.
- **Walk & water** — animated progress rings with celebrations at 100%,
  goal-met streaks, weekly bars with tooltips, and a **sitting & breaks**
  balance card (one break per 45 min target; camera sessions count as an
  honest floor, camera away-detections as automatic breaks).
- **Posture** — 1-tap self check-ins (signature posture figures), movement
  reminders, and the **camera posture AI**:
  - staged startup with warm-up (no frozen “Start” button), WebGL→CPU fallback,
  - guided calibration (countdown → quality-gated samples → specific failure
    reasons) with **sitting/standing profiles**,
  - live skeleton overlay + 0–100 posture score gauge,
  - a smart **alert ladder** (status → toast → notification + optional chime,
    snooze 5m/15m/1h, quiet during away/pause/quiet-hours/flares),
  - **session logging** (day aggregates only — never frames) feeding a
    dashboard tile, a 14-day history chart, and the physio report,
  - an 11-step **“Test my setup”** diagnostics panel with fix-it hints
    (also reachable from Settings → Camera).
- **Wellbeing** — sleep log (hours/quality/position/woke-stiff) with a 14-night
  chart, medication/supplement log with one-tap recent combos and daily
  reminders, **box-breathing** overlay (4-4-4-4), and an opt-in weight trend
  (12-week weekly means — no goals, no BMI).
- **Insights** — a rule-based engine that compares your own days (sleep vs
  stiffness, steps vs next-day pain, posture slump hours, and more) with
  strict statistical honesty: minimum sample sizes, both-side counts in every
  claim, observational wording only, flare days excluded, and locked hints
  that say exactly what to log to unlock each one. Includes a **weekly
  review** — one win, one focus.
- **Flare-up mode** — one tap when things go bad: step goal shrinks, the
  streak is protected, camera alerts go quiet, calm guidance (with the
  red-flag list) is front and centre, and history shows the honest pattern:
  your flares end.
- **Rehab exercises** — seeded library + your own (dialog editor), hold/rest
  timers with set-progress dots and audio cues, done-today tracking.
- **Meal plan / Food** — an editable anti-inflammatory week (today
  highlighted), plus a proper food tracker: USDA-backed food search (with an
  offline starter set of ~76 whole foods, and your own custom foods), a
  portion picker with a live nutrient preview, per-entry nutrient snapshots, a
  daily rollup (calorie ring, macro bars, and a full micronutrient table
  against your targets), and a weekly calories/protein trend.
- **Ergonomics & sleep** — illustrated reference cards and a daily checklist
  with a progress bar.
- **Physio visit report** — printable summary: pain trend + body-map heat,
  flare history, exercise adherence, movement/hydration, camera posture,
  meds frequency, and your recorded physio constraints.
- **Settings** — sticky section nav; theme, reminders, goals, camera (incl.
  overlay/sound toggles and sensitivity), flare reduction, wellbeing options,
  streak forgiveness, physio instructions, nutrition (USDA API key,
  online-lookup toggle, editable daily nutrient targets), backup, per-log
  **CSV export**, and a double-guarded reset.
- **Backup** — export everything to one JSON file; import with Merge or
  Replace (old pre-v2 backups import cleanly).
- **Onboarding** — a gentle, skippable 3-step first-run (safety → goals →
  reminders). Existing users never see it.

## Privacy

No network requests are made for your logged data. Libraries (TensorFlow.js, the
MoveNet pose model) are **vendored locally** in `/vendor` rather than loaded
from a CDN — that's what makes “works offline” and “frames never leave your
device” actually true. The camera posture AI runs entirely in your browser and
**never stores or uploads frames** — only per-day aggregate numbers (minutes
monitored, % good, slouch counts) are saved.

**Food search** is the one feature that reaches the network: when you search
foods, only the words you type are sent to USDA's public FoodData Central
database to fetch nutrition facts. It's optional (toggle it off in Settings),
your logged food and all other data never leave the device, and logging
always works fully offline using the bundled + saved foods.

## Tests (no build step)

Pure-logic suites, runnable headless (`node tests/<name>.test.js`) or all at
once in the browser at <http://localhost:8000/tests/>:

`dates`, `backup`, `posture-heuristic`, `schema`, `posture-score`,
`cam-session`, `alert-ladder`, `cam-diagnostics`, `flare`, `review`,
`insights`, `csv`, `body-regions`, `nutrition`, `foods-starter` — **167
assertions**.

## Notes & decisions

- **Charts** are hand-built inline SVG (no Chart.js dependency) — smaller, fully
  offline, themeable, with optional tooltips/animation and screen-reader data
  tables.
- **Design language (“Steady”)** — system rounded display type, warm sand
  neutrals, guaranteed-contrast state colors, inline SVG stroke icons (no icon
  font), a mobile bottom tab bar, native `<dialog>` sheets, and motion that
  fully disappears under `prefers-reduced-motion`.
- **Statistical honesty** — insights never use causal language, never compare
  below 5 days per side, always show sample sizes, and exclude flare days.
  These rules are enforced by unit tests.
- **Streak grace** forgives an isolated single missed day but breaks on two or
  more consecutive misses (configurable). Flare days never break a streak.
- **Reminders** only fire while the tab is open and may be delayed when it's
  backgrounded (a browser limitation, stated in-app). For hard alarms, also set
  one on your phone.

## Structure

```
index.html, start.command, manifest.webmanifest, service-worker.js
/styles   tokens, base, components, app
/js/core  events, dates, schema, store, backup, ui, notify, theme, charts,
          icons, flare, insights, review, csv, body-regions, nutrition
/js/modules  dashboard, pain-trends, goals, posture-reminders, posture-camera,
             posture-heuristic, posture-score, cam-pipeline, cam-overlay,
             cam-session, alert-ladder, cam-diagnostics, body-map, breathing,
             wellbeing, insights, flare, onboarding, settings,
             ergo-sleep-guide, exercises, meal-plan, meal-log, report
/data     meal-plan, exercises, ergo/sleep content, foods-starter (JSON)
/vendor   tfjs + pose-detection + MoveNet model (local, offline)
/tests    no-build test page + node-runnable suites (167 assertions)
```
