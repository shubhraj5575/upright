// app.js — bootstrap. Seeds the store, registers routes, and starts the router.
// In Phase 0 most modules are placeholders; Settings is real so backup
// (export/import) works from day one and data is never trapped.

import * as store from './core/store.js';
import * as backup from './core/backup.js';
import { el, mount, clear, card, toast, qs } from './core/ui.js';
import * as router from './router.js';

// --- placeholder views (real modules land in later phases) ----------------
const PLACEHOLDERS = {
  dashboard: { title: 'Dashboard', phase: 1, blurb: 'Your day at a glance — pain, posture, movement, water and streaks, with quick-log buttons.' },
  pain: { title: 'Pain & symptoms', phase: 1, blurb: 'Daily pain / stiffness sliders and trend charts with a 7-day rolling average.' },
  goals: { title: 'Walk & water goals', phase: 1, blurb: 'Progress rings, quick water/step entry, and streak badges.' },
  posture: { title: 'Posture', phase: 1, blurb: 'Movement-break reminders, a 1-tap posture self-log, and (later) optional camera posture AI.' },
  exercises: { title: 'Rehab exercises', phase: 3, blurb: 'Your physio exercises with timers, sets/reps, demos and "done today" tracking.' },
  'meal-plan': { title: 'Meal plan', phase: 3, blurb: 'A curated anti-inflammatory starter plan you can customize and reset.' },
  meals: { title: 'Meal log', phase: 3, blurb: 'Quick-add meals with dietary tags and a simple weekly summary.' },
  ergo: { title: 'Ergonomic & sleep guide', phase: 2, blurb: 'Reference cards for desk, sitting, lifting and sleeping positions, with a checklist.' },
};

function placeholderView(meta) {
  return (mountEl) => {
    const view = el('div', { class: 'placeholder' },
      el('span', { class: 'badge badge--primary placeholder__phase' }, `Arrives in Phase ${meta.phase}`),
      el('h1', {}, meta.title),
      el('p', { class: 'text-muted' }, meta.blurb),
      el('p', { class: 'text-faint', style: { marginTop: 'var(--space-4)' } },
        'The foundation (data store, backup, routing) is in place — this view is next.')
    );
    mount(mountEl, card(null, view));
  };
}

// --- Settings (real in Phase 0; Phase 2 extends this same view) -----------
function settingsView(mountEl) {
  const header = el('div', { class: 'view-header' },
    el('h1', {}, 'Settings'),
    el('p', {}, 'Your data stays on this device. Reminder, goal and camera settings arrive in a later phase.')
  );

  // Safety first: disclaimer + red-flag note.
  const disclaimer = card('Important',
    el('div', { class: 'callout' },
      el('p', {}, el('strong', {}, 'Wellness tool, not medical advice. '),
        'Upright supports — it does not replace — the plan your physiotherapist or doctor gave you. ' +
        'Always follow their specific instructions.')
    ),
    el('div', { class: 'callout callout--warn', style: { marginTop: 'var(--space-3)' } },
      el('div', { class: 'callout__title' }, '⚠ Seek prompt medical care if you notice'),
      el('p', {}, 'new numbness in the groin/saddle area, leg weakness, or any loss of bladder or bowel control. ' +
        'These can signal a serious problem and need urgent attention.')
    )
  );

  // Backup section.
  const info = backup.lastBackupInfo();
  const nudge = el('p', { class: 'field__hint' }, lastBackupText(info));

  const exportBtn = el('button', { class: 'btn btn--primary', onClick: onExport }, 'Export backup (.json)');

  const fileInput = el('input', { class: 'input', type: 'file', accept: 'application/json,.json' });
  const modeMerge = el('input', { type: 'radio', name: 'import-mode', value: 'merge', checked: true });
  const modeReplace = el('input', { type: 'radio', name: 'import-mode', value: 'replace' });
  const importBtn = el('button', { class: 'btn', onClick: onImport }, 'Import');

  function lastBackupText(i) {
    if (!i.at) return 'No backup yet. Exporting saves a copy you can re-import if browser data is ever cleared.';
    if (i.days === 0) return 'Last backup: today.';
    if (i.days === 1) return 'Last backup: yesterday.';
    return `Last backup: ${i.days} days ago.`;
  }

  function onExport() {
    const res = backup.exportToFile();
    if (res.ok) {
      nudge.textContent = lastBackupText(backup.lastBackupInfo());
      toast('Backup downloaded.', { type: 'success' });
    } else {
      toast('Could not create backup.', { type: 'error' });
    }
  }

  async function onImport() {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      toast('Choose a backup file first.', { type: 'warn' });
      return;
    }
    const mode = modeReplace.checked ? 'replace' : 'merge';
    const res = await backup.importFromFile(file, mode);
    if (res.ok) {
      toast(`Imported (${mode}). Your data is restored.`, { type: 'success' });
      nudge.textContent = lastBackupText(backup.lastBackupInfo());
      fileInput.value = '';
    } else {
      toast(res.error || 'Import failed.', { type: 'error' });
    }
  }

  const backupCard = card('Your data',
    el('p', { class: 'card__subtitle' },
      'Export the whole app to a single file, or import one back. Clearing your browser data wipes ' +
      'everything stored here, so keep a recent backup.'),
    el('div', { class: 'field' }, exportBtn, nudge),
    el('hr', { style: { border: 'none', borderTop: '1px solid var(--color-border)', margin: 'var(--space-4) 0' } }),
    el('div', { class: 'field' },
      el('label', {}, 'Restore from a backup file'),
      fileInput,
      el('div', { class: 'radio-row', style: { marginTop: 'var(--space-3)' } },
        el('label', {}, modeMerge, ' Merge (keep what’s here, add anything missing)'),
        el('label', {}, modeReplace, ' Replace (overwrite everything with the file)')
      ),
      el('span', { class: 'field__hint' },
        'Merge never overwrites a newer local entry with an older backup — use Replace for that.')
    ),
    el('div', { class: 'row', style: { marginTop: 'var(--space-2)' } }, importBtn)
  );

  mount(mountEl, header, disclaimer, backupCard);
}

// --- boot -----------------------------------------------------------------
function boot() {
  const seeded = store.ensureSeeded();
  if (seeded) {
    // eslint-disable-next-line no-console
    console.info('[Upright] First run — seeded default data.');
  }

  for (const [path, meta] of Object.entries(PLACEHOLDERS)) {
    router.register(path, placeholderView(meta), meta.title);
  }
  router.register('settings', settingsView, 'Settings');

  router.setDefault('dashboard');
  router.setFallback((mountEl, path) => {
    mount(mountEl, card('Page not found',
      el('p', { class: 'text-muted' }, `There’s no "${path}" view. `),
      el('a', { class: 'btn btn--primary', href: '#/dashboard', style: { marginTop: 'var(--space-3)' } }, 'Go to dashboard')
    ));
  });

  router.start(qs('#app'), qs('.main-nav'));
}

boot();
