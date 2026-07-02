// settings.js — the control panel. Real, persisted controls for appearance,
// reminders, goals, camera, streak behaviour, the physio-constraints field,
// the disclaimer acknowledgement, backup, and a guarded reset. Reads settings
// once on init and writes on each input; it deliberately does NOT live-re-render
// the whole form (that would steal focus while typing).

import * as store from '../core/store.js';
import * as backup from '../core/backup.js';
import * as notify from '../core/notify.js';
import { mergeSettings } from '../core/schema.js';
import { el, mount, card, toast, slider } from '../core/ui.js';
import { applyTheme } from '../core/theme.js';
import { resetReminderClock } from './posture-reminders.js';

function settings() {
  return store.get('settings') || {};
}
function patch(mutator) {
  store.update('settings', (s) => {
    // Backfill first: a partial settings object (e.g. freshly imported from an
    // old backup) must never leave a mutator touching a missing nested object.
    const next = mergeSettings(JSON.parse(JSON.stringify(s || {})));
    mutator(next);
    return next;
  });
}

// --- sections -------------------------------------------------------------

function disclaimerCard() {
  const s = settings();
  const status = el('p', { class: 'field__hint' });
  const ackBtn = el('button', { class: 'btn btn--primary' });

  function refresh() {
    const ackAt = settings().disclaimerAckAt;
    if (ackAt) {
      status.textContent = `Acknowledged on ${new Date(ackAt).toLocaleDateString()}.`;
      ackBtn.textContent = 'Acknowledged ✓';
      ackBtn.disabled = true;
    } else {
      status.textContent = 'Please read and acknowledge the above.';
      ackBtn.textContent = 'I understand';
      ackBtn.disabled = false;
    }
  }
  ackBtn.addEventListener('click', () => {
    patch((n) => { n.disclaimerAckAt = new Date().toISOString(); });
    refresh();
    toast('Thanks — acknowledgement saved.', { type: 'success' });
  });
  refresh();

  return card('Important — please read',
    el('div', { class: 'callout' },
      el('p', {}, el('strong', {}, 'Wellness tool, not medical advice. '),
        'Upright supports — it does not replace — the plan your physiotherapist or doctor gave you. '
        + 'Always follow their specific instructions.')),
    el('div', { class: 'callout callout--warn', style: { marginTop: 'var(--space-3)' } },
      el('div', { class: 'callout__title' }, '⚠ Seek prompt medical care if you notice'),
      el('p', {}, 'new numbness in the groin/saddle area, leg weakness, or any loss of bladder or bowel control. '
        + 'These can signal a serious problem and need urgent attention.')),
    el('div', { class: 'row', style: { marginTop: 'var(--space-4)' } }, ackBtn, status)
  );
}

function appearanceCard() {
  const cur = settings().theme || 'system';
  const radios = ['system', 'light', 'dark'].map((t) => {
    const input = el('input', { type: 'radio', name: 'theme', value: t, checked: t === cur,
      onChange: () => { patch((n) => { n.theme = t; }); applyTheme(t); } });
    return el('label', {}, input, ' ', t[0].toUpperCase() + t.slice(1));
  });
  return card('Appearance',
    el('div', { class: 'field', style: { marginBottom: 0 } },
      el('label', {}, 'Theme'),
      el('div', { class: 'radio-row' }, ...radios),
      el('span', { class: 'field__hint' }, '“System” follows your device’s light/dark setting.'))
  );
}

function remindersCard() {
  const r = settings().reminders || {};
  const permNote = el('span', { class: 'field__hint' });
  function refreshPerm() {
    const p = notify.permission();
    permNote.textContent = p === 'granted' ? 'Notifications allowed.'
      : p === 'denied' ? 'Notifications blocked by the browser — Upright will show an in-app banner instead.'
      : p === 'unsupported' ? 'This browser can’t show notifications — Upright will use in-app banners.'
      : 'Tip: allow notifications when prompted for alerts outside the tab.';
  }
  refreshPerm();

  const enable = el('input', { type: 'checkbox', checked: !!r.enabled,
    onChange: async (e) => {
      const on = e.target.checked;
      if (on) { await notify.requestPermission(); resetReminderClock(); refreshPerm(); }
      patch((n) => { n.reminders.enabled = on; });
      toast(on ? 'Reminders on.' : 'Reminders off.', { type: 'info' });
    } });

  const postureInt = numberField('Posture check (min)', r.postureIntervalMin, 5, 240, 5,
    (v) => patch((n) => { n.reminders.postureIntervalMin = v; }));
  const moveInt = numberField('Movement break (min)', r.movementIntervalMin, 5, 240, 5,
    (v) => patch((n) => { n.reminders.movementIntervalMin = v; }));
  const start = timeField('Active from', (r.activeHours || {}).start || '08:00',
    (v) => patch((n) => { n.reminders.activeHours.start = v; }));
  const end = timeField('Active until', (r.activeHours || {}).end || '20:00',
    (v) => patch((n) => { n.reminders.activeHours.end = v; }));

  return card('Reminders',
    el('p', { class: 'card__subtitle' }, 'Gentle nudges to check your posture and get moving.'),
    el('label', { class: 'row', style: { gap: 'var(--space-2)' } }, enable, ' Enable reminders'),
    el('div', { class: 'grid', style: { marginTop: 'var(--space-4)' } }, postureInt, moveInt, start, end),
    el('div', { class: 'callout', style: { marginTop: 'var(--space-3)' } },
      el('p', {}, 'Reminders only fire while this tab is open, and may be delayed when it’s in the background — '
        + 'a browser limitation. For hard alarms, also set one on your phone.'),
      permNote)
  );
}

function goalsCard() {
  const g = settings().goals || {};
  const water = numberField('Daily water goal (L)', (g.waterMl || 2000) / 1000, 0.5, 6, 0.25,
    (v) => patch((n) => { n.goals.waterMl = Math.round(v * 1000); }));
  const waterStep = numberField('Water “+” size (ml)', g.waterStepMl || 250, 50, 1000, 50,
    (v) => patch((n) => { n.goals.waterStepMl = v; }));
  const steps = numberField('Daily step goal', g.steps || 6000, 500, 30000, 500,
    (v) => patch((n) => { n.goals.steps = v; }));
  return card('Daily goals',
    el('div', { class: 'grid' }, water, waterStep, steps),
    el('span', { class: 'field__hint' }, 'Talk to your physio about a safe step target for your stage of recovery.')
  );
}

function cameraCard() {
  const c = settings().postureCamera || {};
  const enable = el('input', { type: 'checkbox', checked: !!c.enabled,
    onChange: (e) => { patch((n) => { n.postureCamera.enabled = e.target.checked; });
      toast('Saved — open Posture to use the camera.', { type: 'info' }); } });
  const sens = slider({ id: 'cam-sens', label: 'Slouch sensitivity', min: 0, max: 1, step: 0.05,
    value: c.sensitivity ?? 0.5,
    format: (v) => (v < 0.34 ? 'Relaxed' : v < 0.67 ? 'Balanced' : 'Strict'),
    onInput: (v) => patch((n) => { n.postureCamera.sensitivity = v; }) });
  return card('Camera posture AI',
    el('p', { class: 'card__subtitle' }, 'Optional. Uses your webcam on-device to flag slouching. '
      + 'Frames never leave your device and are never stored.'),
    el('label', { class: 'row', style: { gap: 'var(--space-2)' } }, enable, ' Enable camera posture monitoring'),
    el('div', { style: { marginTop: 'var(--space-4)', maxWidth: '360px' } }, sens.field)
  );
}

function streakCard() {
  const cur = settings().streakGrace ?? 1;
  const opts = [
    { v: 0, label: 'Strict — any missed day resets' },
    { v: 1, label: 'Forgive one missed day (recommended)' },
    { v: 2, label: 'Forgive up to two missed days' },
  ];
  const select = el('select', { class: 'select',
    onChange: (e) => { patch((n) => { n.streakGrace = Number(e.target.value); }); toast('Streak rule updated.', { type: 'info' }); } },
    ...opts.map((o) => el('option', { value: o.v, selected: o.v === cur }, o.label)));
  return card('Streaks',
    el('div', { class: 'field', style: { marginBottom: 0, maxWidth: '420px' } },
      el('label', {}, 'How forgiving should streaks be?'),
      select,
      el('span', { class: 'field__hint' }, 'A recovery app shouldn’t punish a single off day.'))
  );
}

function physioCard() {
  const ta = el('textarea', { class: 'textarea', id: 'physio', rows: 5,
    placeholder: 'e.g. “No loaded forward flexion. McGill Big 3 daily. Walk 3×10 min. Avoid sitting >30 min.”' });
  ta.value = settings().physioConstraints || '';
  const save = el('button', { class: 'btn btn--primary', onClick: () => {
    patch((n) => { n.physioConstraints = ta.value.trim(); });
    toast('Your physio’s instructions are saved.', { type: 'success' });
  } }, 'Save');
  return card('Your physio’s instructions',
    el('p', { class: 'card__subtitle' }, 'Record exactly what your physiotherapist told you. '
      + 'It appears on the printable visit report so the app reflects your real plan.'),
    el('div', { class: 'field' }, el('label', { for: 'physio' }, 'Constraints & prescription'), ta),
    save
  );
}

function dataCard() {
  const info = backup.lastBackupInfo();
  const nudge = el('p', { class: 'field__hint' }, lastBackupText(info));

  function lastBackupText(i) {
    if (!i.at) return 'No backup yet. Exporting saves a copy you can re-import if browser data is ever cleared.';
    if (i.days === 0) return 'Last backup: today.';
    if (i.days === 1) return 'Last backup: yesterday.';
    return `Last backup: ${i.days} days ago.`;
  }

  const exportBtn = el('button', { class: 'btn btn--primary', onClick: () => {
    const res = backup.exportToFile();
    if (res.ok) { nudge.textContent = lastBackupText(backup.lastBackupInfo()); toast('Backup downloaded.', { type: 'success' }); }
    else toast('Could not create backup.', { type: 'error' });
  } }, 'Export backup (.json)');

  const fileInput = el('input', { class: 'input', type: 'file', accept: 'application/json,.json' });
  const modeMerge = el('input', { type: 'radio', name: 'import-mode', value: 'merge', checked: true });
  const modeReplace = el('input', { type: 'radio', name: 'import-mode', value: 'replace' });
  const importBtn = el('button', { class: 'btn', onClick: async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) { toast('Choose a backup file first.', { type: 'warn' }); return; }
    const mode = modeReplace.checked ? 'replace' : 'merge';
    const res = await backup.importFromFile(file, mode);
    if (res.ok) { toast(`Imported (${mode}). Your data is restored.`, { type: 'success' }); fileInput.value = ''; nudge.textContent = lastBackupText(backup.lastBackupInfo()); }
    else toast(res.error || 'Import failed.', { type: 'error' });
  } }, 'Import');

  return card('Your data',
    el('p', { class: 'card__subtitle' }, 'Everything stays on this device. Clearing your browser data wipes it, so keep a recent backup.'),
    el('div', { class: 'field' }, exportBtn, nudge),
    el('hr', { class: 'rule' }),
    el('div', { class: 'field' },
      el('label', {}, 'Restore from a backup file'),
      fileInput,
      el('div', { class: 'radio-row', style: { marginTop: 'var(--space-3)' } },
        el('label', {}, modeMerge, ' Merge (keep what’s here, add anything missing)'),
        el('label', {}, modeReplace, ' Replace (overwrite everything with the file)')),
      el('span', { class: 'field__hint' }, 'Merge never overwrites a newer local entry with an older backup.')),
    el('div', { class: 'row' }, importBtn)
  );
}

function dangerCard() {
  const host = el('div', {});
  function idle() {
    return el('button', { class: 'btn btn--danger', onClick: () => { host.replaceChildren(confirm()); } }, 'Reset all data…');
  }
  function confirm() {
    return el('div', { class: 'callout callout--warn' },
      el('p', {}, el('strong', {}, 'This permanently deletes all your logs, settings and plans on this device.')),
      el('p', { class: 'field__hint' }, 'Consider exporting a backup first.'),
      el('div', { class: 'row', style: { marginTop: 'var(--space-3)' } },
        el('button', { class: 'btn btn--ghost', onClick: () => { host.replaceChildren(idle()); } }, 'Cancel'),
        el('button', { class: 'btn btn--danger', onClick: () => {
          store.clearAll();
          store.ensureSeeded();
          toast('All data has been reset.', { type: 'info' });
          location.hash = '#/dashboard';
        } }, 'Yes, erase everything')));
  }
  host.appendChild(idle());
  return card('Danger zone', host);
}

// --- small field helpers --------------------------------------------------
function numberField(label, value, min, max, step, onChange) {
  const input = el('input', { class: 'input', type: 'number', min, max, step, value,
    onChange: (e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) onChange(v); } });
  return el('div', { class: 'field', style: { marginBottom: 0 } }, el('label', {}, label), input);
}
function timeField(label, value, onChange) {
  const input = el('input', { class: 'input', type: 'time', value, onChange: (e) => onChange(e.target.value) });
  return el('div', { class: 'field', style: { marginBottom: 0 } }, el('label', {}, label), input);
}

export function init(mountEl) {
  mount(mountEl,
    el('div', { class: 'view-header' }, el('h1', {}, 'Settings'), el('p', {}, 'Make Upright fit your recovery. Everything here is saved on this device.')),
    disclaimerCard(),
    appearanceCard(),
    remindersCard(),
    goalsCard(),
    cameraCard(),
    streakCard(),
    physioCard(),
    dataCard(),
    dangerCard()
  );
}
