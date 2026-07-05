// onboarding.js — a gentle 3-step first-run dialog: safety disclaimer →
// daily goals → reminders. Entirely skippable; finishing (or skipping) stamps
// settings.onboardedAt so it never shows again. Users with existing history
// are grandfathered in silently.

import * as store from '../core/store.js';
import { el, mount, clear, openDialog } from '../core/ui.js';
import { icon } from '../core/icons.js';
import * as notify from '../core/notify.js';
import { resetReminderClock } from './posture-reminders.js';

function settings() {
  return store.get('settings') || {};
}
function patch(mutator) {
  store.update('settings', (s) => {
    const next = JSON.parse(JSON.stringify(s || {}));
    mutator(next);
    return next;
  });
}

function hasAnyHistory() {
  const nonEmpty = (k) => {
    const v = store.get(k);
    return v && (Array.isArray(v) ? v.length : Object.keys(v).length);
  };
  return nonEmpty('painLog') || nonEmpty('goalsLog') || nonEmpty('postureSelfLog') || nonEmpty('exerciseLog');
}

function stamp() {
  patch((n) => { n.onboardedAt = new Date().toISOString(); });
}

/** Call once at boot. Shows the dialog only for genuinely fresh installs. */
export function maybeOnboard() {
  const s = settings();
  if (s.onboardedAt) return;
  if (hasAnyHistory()) { stamp(); return; } // existing user — never nag
  openOnboarding();
}

function openOnboarding() {
  let step = 0;
  const body = el('div', { class: 'onboarding' });
  const dots = el('div', { class: 'onboarding__dots', 'aria-hidden': 'true' },
    ...[0, 1, 2].map(() => el('span', { class: 'onboarding__dot' })));
  const backBtn = el('button', { class: 'btn btn--ghost', onClick: () => go(step - 1) }, 'Back');
  const nextBtn = el('button', { class: 'btn btn--primary' });
  const skipBtn = el('button', { class: 'btn btn--ghost', onClick: () => { stamp(); handle.close(); } }, 'Skip for now');

  const handle = openDialog({
    title: 'Welcome to Upright',
    content: el('div', {}, body, dots),
    actions: [skipBtn, backBtn, nextBtn],
    onClose: () => { if (!settings().onboardedAt) stamp(); }, // Esc/backdrop = skip
  });

  // --- steps ------------------------------------------------------------------
  function stepSafety() {
    return el('div', {},
      el('p', {}, el('strong', {}, 'Upright is a wellness tool, not medical advice.'),
        ' It supports — never replaces — the plan your physiotherapist or doctor gave you.'),
      el('div', { class: 'callout callout--warn', style: { marginTop: 'var(--space-3)' } },
        el('div', { class: 'callout__title' }, 'Seek prompt medical care if you notice'),
        el('p', {}, 'new numbness in the groin/saddle area, leg weakness, or any loss of bladder or bowel control.')),
      el('p', { class: 'field__hint', style: { marginTop: 'var(--space-3)' } },
        'Everything you log stays in this browser, on this device — your logs are never uploaded. ',
        '(The only thing that ever leaves: the words you type into food search, sent to a public ',
        'food database to look up nutrition — and only if you use online search.)'));
  }

  function stepGoals() {
    const g = settings().goals || {};
    const water = el('input', { class: 'input', type: 'number', min: 0.5, max: 6, step: 0.25, value: (g.waterMl || 2000) / 1000 });
    const steps = el('input', { class: 'input', type: 'number', min: 500, max: 30000, step: 500, value: g.steps || 6000 });
    const wrap = el('div', {},
      el('p', {}, 'Two small daily goals to start with — you can change them any time in Settings.'),
      el('div', { class: 'grid', style: { marginTop: 'var(--space-3)' } },
        el('div', { class: 'field', style: { marginBottom: 0 } }, el('label', {}, 'Daily water (litres)'), water),
        el('div', { class: 'field', style: { marginBottom: 0 } }, el('label', {}, 'Daily steps'), steps)),
      el('p', { class: 'field__hint', style: { marginTop: 'var(--space-3)' } },
        'Ask your physio what a safe step target looks like for your stage of recovery.'));
    wrap._save = () => {
      const w = Number(water.value);
      const st = Number(steps.value);
      patch((n) => {
        if (w >= 0.5 && w <= 6) n.goals.waterMl = Math.round(w * 1000);
        if (st >= 500 && st <= 30000) n.goals.steps = Math.round(st);
      });
    };
    return wrap;
  }

  function stepReminders() {
    const status = el('p', { class: 'field__hint', style: { marginTop: 'var(--space-2)' } });
    const enableBtn = el('button', {
      class: 'btn btn--primary',
      onClick: async () => {
        await notify.requestPermission();
        patch((n) => { n.reminders.enabled = true; });
        resetReminderClock();
        status.textContent = notify.permission() === 'granted'
          ? 'Reminders are on, with notifications.'
          : 'Reminders are on — they’ll appear as in-app banners.';
        enableBtn.disabled = true;
      },
    }, icon('bell', { size: 16 }), 'Turn on gentle reminders');
    return el('div', {},
      el('p', {}, 'Upright can nudge you to check your posture and take movement breaks while the app is open.'),
      el('div', { style: { marginTop: 'var(--space-3)' } }, enableBtn, status),
      el('p', { class: 'field__hint', style: { marginTop: 'var(--space-4)' } },
        'There’s also an optional on-device camera posture monitor — find it under Posture when you’re ready. Frames never leave your device.'));
  }

  const steps = [stepSafety, stepGoals, stepReminders];
  let currentNode = null;

  function go(to) {
    // Persist the goals step when moving on.
    if (currentNode && typeof currentNode._save === 'function' && to > step) currentNode._save();
    step = Math.max(0, Math.min(steps.length - 1, to));
    clear(body);
    currentNode = steps[step]();
    mount(body, currentNode);
    dots.querySelectorAll('.onboarding__dot').forEach((d, i) => d.classList.toggle('onboarding__dot--on', i === step));
    backBtn.style.visibility = step === 0 ? 'hidden' : 'visible';
    nextBtn.replaceChildren(step === steps.length - 1 ? 'Get started' : 'Next');
  }
  nextBtn.addEventListener('click', () => {
    if (step === steps.length - 1) {
      if (currentNode && typeof currentNode._save === 'function') currentNode._save();
      stamp();
      handle.close();
    } else {
      go(step + 1);
    }
  });

  go(0);
}
