# Upright — Back-Recovery & Posture Companion

A private, **local-first** web app to support recovery from a lower-back injury.
Everything runs in your browser; all data stays on your device. No login, no
server, no accounts.

> **Upright is a wellness tool, not medical advice.** It complements the plan
> your physiotherapist or doctor gave you — it does not replace it. Always
> follow their specific instructions.
>
> **Seek prompt medical care** if you notice new numbness in the groin/saddle
> area, leg weakness, or any loss of bladder or bowel control.

## Running it

A tiny local server is required (browser ES modules and — later — the webcam
need a `localhost` secure context, so opening the file directly won't work).

**Easiest:** double-click `start.command` *(added in Phase 4)*.

**Manual:**

```sh
cd "path/to/this/folder"
python3 -m http.server 8000
```

Then open <http://localhost:8000> in Chrome. Keep it as a pinned tab so
reminders can fire while it's open.

## Tests (no build step)

Pure-logic tests for the date/streak math and the backup round-trip:

- **Headless:** `node tests/dates.test.js` and `node tests/backup.test.js`
- **In the browser:** open <http://localhost:8000/tests/>

## Project status — Phase 0 (Foundation) complete

Built so far:

- **Data store** (`js/core/store.js`) — namespaced `localStorage`, one change
  event per mutation; `subscribe` is sugar over the event bus.
- **Schema** (`js/core/schema.js`) — keys, defaults, import validation.
- **Dates** (`js/core/dates.js`) — local day keys (never UTC) and streak math
  with a one-missed-day grace rule.
- **Backup** (`js/core/backup.js`) — export/import to one JSON file, with
  additive **Merge** (local wins) or full **Replace**.
- **Event bus** (`js/core/events.js`) and **DOM/toast helpers** (`js/core/ui.js`).
- **Router** (`js/router.js`) + **app shell** (`index.html`, `js/app.js`) with a
  working **Settings → backup** screen so your data is never trapped.

Feature modules (dashboard, pain trends, goals, posture, exercises, meals,
ergonomics, camera posture AI) arrive in Phases 1–5.

### Grace-rule decision (please confirm)

The streak counter forgives an **isolated single missed day**, but **two or more
consecutive missed days break the streak**. So logging every other day keeps a
streak alive; missing two days in a row does not. Change this in
`js/core/dates.js → computeStreak` if you'd prefer stricter or looser behavior.

## Privacy

No network requests are made for your data. Libraries (charts, the camera pose
model) are **vendored locally** rather than loaded from a CDN, which is what
makes "works offline" and "frames never leave your device" actually true.
