// app.js — bootstrap. Seeds the store, applies the theme, registers routes,
// starts the global reminder loop, and starts the router.

import * as store from './core/store.js';
import { mergeSettings } from './core/schema.js';
import { el, mount, card, qs, qsa, openDialog } from './core/ui.js';
import { icon } from './core/icons.js';
import { applyTheme } from './core/theme.js';
import * as router from './router.js';
import * as dashboard from './modules/dashboard.js';
import * as painTrends from './modules/pain-trends.js';
import * as goals from './modules/goals.js';
import * as posture from './modules/posture-reminders.js';
import * as settings from './modules/settings.js';
import * as ergo from './modules/ergo-sleep-guide.js';
import * as exercises from './modules/exercises.js';
import * as mealPlan from './modules/meal-plan.js';
import * as mealLog from './modules/meal-log.js';
import * as report from './modules/report.js';
import * as onboarding from './modules/onboarding.js';

function boot() {
  const seeded = store.ensureSeeded();
  if (seeded) {
    // eslint-disable-next-line no-console
    console.info('[Upright] First run — seeded default data.');
  }

  // Backfill any settings fields added since this device's data was created,
  // then apply the saved theme before first paint of any view.
  store.update('settings', (s) => mergeSettings(s));
  applyTheme((store.get('settings') || {}).theme || 'system');

  // Feature modules (init/getSummary contract).
  router.register('dashboard', dashboard.init, 'Dashboard');
  router.register('pain', painTrends.init, 'Pain & symptoms');
  router.register('goals', goals.init, 'Walk & water');
  router.register('posture', posture.init, 'Posture');
  router.register('exercises', exercises.init, 'Rehab exercises');
  router.register('meal-plan', mealPlan.init, 'Meal plan');
  router.register('meals', mealLog.init, 'Food');
  router.register('ergo', ergo.init, 'Ergonomics & sleep');
  router.register('report', report.init, 'Physio report');
  router.register('settings', settings.init, 'Settings');

  router.setDefault('dashboard');
  router.setFallback((mountEl, path) => {
    mount(mountEl, card('Page not found',
      el('p', { class: 'text-muted' }, `There’s no "${path}" view. `),
      el('a', { class: 'btn btn--primary', href: '#/dashboard', style: { marginTop: 'var(--space-3)' } }, 'Go to dashboard')
    ));
  });

  setupTabBar();

  router.start(qs('#app'), qs('.main-nav'));

  // Global reminder loop (independent of the active view).
  posture.startReminders();

  // First-run onboarding (no-op for existing users).
  onboarding.maybeOnboard();

  // PWA: register the service worker for installability + offline.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
}

// Everything reachable from the mobile "More" sheet (not on the tab bar).
const MORE_ROUTES = [
  { path: 'goals', label: 'Walk & water', icon: 'droplet' },
  { path: 'meals', label: 'Food', icon: 'utensils' },
  { path: 'meal-plan', label: 'Meal plan', icon: 'calendar' },
  { path: 'ergo', label: 'Ergonomics & sleep', icon: 'bed' },
  { path: 'report', label: 'Physio report', icon: 'file-text' },
  { path: 'settings', label: 'Settings', icon: 'sliders' },
];

function setupTabBar() {
  // Inject stroke icons (declared as data-icon so the markup stays readable).
  for (const item of qsa('.tab-bar [data-icon]')) {
    const holder = item.querySelector('.tab-bar__icon');
    if (holder) holder.appendChild(icon(item.dataset.icon, { size: 22 }));
  }
  const moreBtn = qs('#tab-more');
  if (!moreBtn) return;
  // Light the More tab whenever the active route lives inside the sheet.
  moreBtn.dataset.nav = MORE_ROUTES.map((r) => r.path).join(',');
  moreBtn.addEventListener('click', () => {
    const current = router.currentPath();
    const grid = el('nav', { class: 'more-grid', 'aria-label': 'More destinations' },
      ...MORE_ROUTES.map((r) => el('a', {
        href: '#/' + r.path,
        class: r.path === current ? 'is-active' : null,
        onClick: () => handle.close(),
      }, icon(r.icon, { size: 20 }), r.label))
    );
    const handle = openDialog({ title: 'More', content: grid });
  });
}

boot();
