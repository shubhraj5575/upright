// app.js — bootstrap. Seeds the store, applies the theme, registers routes,
// starts the global reminder loop, and starts the router.

import * as store from './core/store.js';
import { el, mount, card, qs } from './core/ui.js';
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

function boot() {
  const seeded = store.ensureSeeded();
  if (seeded) {
    // eslint-disable-next-line no-console
    console.info('[Upright] First run — seeded default data.');
  }

  // Apply saved theme before first paint of any view.
  applyTheme((store.get('settings') || {}).theme || 'system');

  // Feature modules (init/getSummary contract).
  router.register('dashboard', dashboard.init, 'Dashboard');
  router.register('pain', painTrends.init, 'Pain & symptoms');
  router.register('goals', goals.init, 'Walk & water');
  router.register('posture', posture.init, 'Posture');
  router.register('exercises', exercises.init, 'Rehab exercises');
  router.register('meal-plan', mealPlan.init, 'Meal plan');
  router.register('meals', mealLog.init, 'Meal log');
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

  router.start(qs('#app'), qs('.main-nav'));

  // Global reminder loop (independent of the active view).
  posture.startReminders();
}

boot();
