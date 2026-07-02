// icons.js — inline SVG stroke icon system ("Steady"). 24×24 grid, 2px round
// strokes, currentColor — icons inherit text color and re-theme for free.
// Replaces emoji-as-icons everywhere except mood anchors on the pain form and
// OS notification titles (emoji render fine in those two contexts).
//
// Usage: icon('flame') → <svg aria-hidden>; icon('flame', { label: 'Streak' })
// → labelled image. The posture-1…posture-5 set is a signature seated figure
// that slumps progressively — used for posture check-in ratings.

const PATHS = {
  // --- navigation / sections ---------------------------------------------
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  droplet: '<path d="M12 2.7s6.5 6.9 6.5 11a6.5 6.5 0 0 1-13 0c0-4.1 6.5-11 6.5-11z"/>',
  walk: '<circle cx="13" cy="4.5" r="2"/><path d="M12.7 7.5 10.5 13l2 3 .8 4.5"/><path d="M10.5 13l-2.6 1.8"/><path d="M12.2 9.2l3.3 1.8 2 .4"/><path d="M12.5 16l-2.8 4.7"/>',
  dumbbell: '<path d="M6.5 6.5v11"/><path d="M17.5 6.5v11"/><path d="M3 9v6"/><path d="M21 9v6"/><path d="M6.5 12h11"/>',
  utensils: '<path d="M7 2v6a2.5 2.5 0 0 0 5 0V2"/><path d="M9.5 2v20"/><path d="M20 15V2a5 5 0 0 0-4 5v6a2 2 0 0 0 2 2h2zv7"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  lightbulb: '<path d="M12 3a6 6 0 0 0-3.4 10.9c.8.6 1.4 1.5 1.4 2.5h4c0-1 .6-1.9 1.4-2.5A6 6 0 0 0 12 3z"/><path d="M9.5 19.5h5"/><path d="M10.5 22h3"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
  'more-horizontal': '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  bed: '<path d="M2 5v14"/><path d="M2 9h17a3 3 0 0 1 3 3v7"/><path d="M2 16h20"/><circle cx="7" cy="12.5" r="1.5"/>',

  // --- actions --------------------------------------------------------------
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  'chevron-right': '<path d="M9 18l6-6-6-6"/>',
  'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
  refresh: '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M20.5 15a9 9 0 0 1-14.9 3.4L1 14"/><path d="M3.5 9A9 9 0 0 1 18.4 5.6L23 10"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  play: '<path d="M6 4.5 19 12 6 19.5z"/>',
  pause: '<path d="M7 4.5v15"/><path d="M17 4.5v15"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
  printer: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>',

  // --- states / signals ------------------------------------------------------
  'alert-triangle': '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  'bell-off': '<path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13c-.4-1.3-.6-3-.6-5A6 6 0 0 0 7.4 4.4"/><path d="M5.3 8C5.1 12.8 3 17 3 17h13"/><path d="M2 2l20 20"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  video: '<rect x="1" y="5" width="15" height="14" rx="2"/><path d="M23 7l-7 5 7 5z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  timer: '<circle cx="12" cy="14" r="8"/><path d="M12 11v3l2 2"/><path d="M10 2h4"/><path d="M12 2v4"/>',
  flame: '<path d="M12 2s-6 6.2-6 11a6 6 0 0 0 12 0c0-1.8-.8-3.7-1.9-5.5C14.9 5.6 12 2 12 2z"/><path d="M12 12.5s-2 1.9-2 3.3a2 2 0 0 0 4 0c0-1.4-2-3.3-2-3.3z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  pill: '<path d="M10.5 20.5l-7-7a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7z"/><path d="M8.5 8.5l7 7"/>',
  scale: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8.2 9.5a4.5 4.5 0 0 1 7.6 0"/><path d="M12 8.8l1.7-1.7"/>',
  wind: '<path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 19.1l1.4-1.4"/><path d="M17.7 6.3l1.4-1.4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  'trending-up': '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  'trending-down': '<path d="M23 18l-9.5-9.5-5 5L1 6"/><path d="M17 18h6v-6"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',

  // --- signature posture figures (seated, side view, slump progression) ----
  'posture-5': '<circle cx="13" cy="4.6" r="2.1"/><path d="M12.7 7 12.2 15"/><path d="M12.2 15h5.3"/><path d="M17.5 15v5.5"/><path d="M12.4 9.5l-.3 4.5"/>',
  'posture-4': '<circle cx="13.3" cy="5" r="2.1"/><path d="M12.9 7.3Q12 11 12.2 15"/><path d="M12.2 15h5.3"/><path d="M17.5 15v5.5"/><path d="M12.6 9.7l-.5 4.3"/>',
  'posture-3': '<circle cx="13.9" cy="5.8" r="2.1"/><path d="M13.4 8Q11.8 11.5 12.2 15"/><path d="M12.2 15h5.3"/><path d="M17.5 15v5.5"/><path d="M12.9 10.2l-.8 3.8"/>',
  'posture-2': '<circle cx="14.6" cy="6.8" r="2.1"/><path d="M14 8.8Q11.3 12 12.2 15"/><path d="M12.2 15h5.3"/><path d="M17.5 15v5.5"/><path d="M13.2 10.8l-1.1 3.2"/>',
  'posture-1': '<circle cx="15.4" cy="8.2" r="2.1"/><path d="M14.7 10Q10.9 12.6 12.2 15"/><path d="M12.2 15h5.3"/><path d="M17.5 15v5.5"/><path d="M13.4 11.6l-1.3 2.4"/>',
};

export const ICON_NAMES = Object.keys(PATHS);

/**
 * Build an inline SVG icon element.
 * @param {string} name  key in PATHS
 * @param {{ size?: number, label?: string, className?: string }} [opts]
 *   label: accessible name — omit for decorative icons (aria-hidden).
 * @returns {SVGElement}
 */
export function icon(name, opts = {}) {
  const { size = 24, label, className } = opts;
  const inner = PATHS[name];
  const tpl = document.createElement('template');
  tpl.innerHTML =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
    `class="icon${className ? ' ' + className : ''}${inner ? '' : ' icon--missing'}" ` +
    (label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"') +
    `>${inner || '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>'}</svg>`;
  return tpl.content.firstElementChild;
}

/** The posture figure for a 1..5 rating (clamped). */
export function postureIcon(rating, opts = {}) {
  const r = Math.max(1, Math.min(5, Math.round(rating || 3)));
  return icon(`posture-${r}`, opts);
}
