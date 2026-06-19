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

## Features

- **Dashboard** — today at a glance (pain, posture, water, steps, exercises,
  meals) with quick-log buttons and a logging streak. Live-updates as you log.
- **Pain & symptoms** — daily pain/stiffness/mood/notes; trend chart with
  1w/4w/12w ranges and a 7-day rolling average.
- **Walk & water** — progress rings, quick entry, goal-met streaks, weekly bars.
- **Posture** — 1-tap self check-ins, timed movement-break reminders, and an
  optional **on-device camera posture AI** (see below).
- **Rehab exercises** — seeded library + your own; per-exercise hold/rest timer
  with an audio cue, sets tally, and “done today” tracking.
- **Meal plan** — a curated anti-inflammatory weekly plan you can edit and reset.
- **Meal log** — quick-add meals with dietary tags + a weekly summary.
- **Ergonomics & sleep** — illustrated reference cards and a daily checklist.
- **Physio visit report** — a printable one-page summary (pain trend, exercise
  adherence, your recorded physio constraints) to take to appointments.
- **Settings** — full controls: theme (system/light/dark), reminders, goals,
  camera, streak forgiveness, your physio’s instructions, backup, and reset.
- **Backup** — export everything to one JSON file; import with Merge or Replace.

## Privacy

No network requests are made for your data. Libraries (TensorFlow.js, the
MoveNet pose model) are **vendored locally** in `/vendor` rather than loaded
from a CDN — that's what makes “works offline” and “frames never leave your
device” actually true. The camera posture AI runs entirely in your browser and
**never stores or uploads frames**.

## Tests (no build step)

Pure-logic tests for the date/streak math, backup round-trip, and posture
heuristic:

- **Headless:** `node tests/dates.test.js`, `node tests/backup.test.js`,
  `node tests/posture-heuristic.test.js`
- **In the browser:** open <http://localhost:8000/tests/>

## Project status — all phases complete

Phase 0 foundation → Phase 1 daily-use modules → Phase 2 reminders/settings/ergo
→ Phase 3 exercises/meals → Phase 4 polish + printable report + launcher →
Phase 5 camera posture AI → Phase 6 PWA. 38 unit assertions passing.

### Notes & decisions
- **Charts** are hand-built inline SVG (no Chart.js dependency) — smaller, fully
  offline, themeable, and nothing to rot over the years.
- **Streak grace** forgives an isolated single missed day but breaks on two or
  more consecutive misses. This is configurable in **Settings → Streaks**.
- **Reminders** only fire while the tab is open and may be delayed when it's
  backgrounded (a browser limitation, stated in-app). For hard alarms, also set
  one on your phone.

## Structure

```
index.html, start.command, manifest.webmanifest, service-worker.js
/styles   tokens, base, components, app
/js/core  events, dates, schema, store, backup, ui, notify, theme, charts
/js/modules  dashboard, pain-trends, goals, posture-reminders, posture-camera,
             posture-heuristic, settings, ergo-sleep-guide, exercises,
             meal-plan, meal-log, report
/data     meal-plan, exercises, ergo/sleep content (JSON)
/vendor   tfjs + pose-detection + MoveNet model (local, offline)
/tests    no-build test page + node-runnable suites
```
