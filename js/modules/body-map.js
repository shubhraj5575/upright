// body-map.js — a hand-drawn back-view figure with nine tappable regions for
// "where does it hurt?". Regions are real toggle buttons to screen readers
// (role=checkbox, Space/Enter), not just pretty shapes. Pure vocabulary and
// tallies live in core/body-regions.js.

import { REGIONS, regionLabel } from '../core/body-regions.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// Region shapes on a 200×260 canvas (back view: person's left = viewer's left).
const SHAPES = {
  neck: 'M88 38 h24 v22 h-24 z',
  'shoulder-l': 'M38 60 Q60 52 88 58 L88 84 Q60 84 40 90 Q36 72 38 60 Z',
  'shoulder-r': 'M162 60 Q140 52 112 58 L112 84 Q140 84 160 90 Q164 72 162 60 Z',
  'mid-back': 'M64 88 h72 v52 h-72 z',
  'lower-l': 'M60 144 h26 v40 h-28 q-1-20 2-40 z',
  'lower-c': 'M88 144 h24 v40 h-24 z',
  'lower-r': 'M114 144 h26 q3 20 2 40 h-28 z',
  'hip-l': 'M56 188 q22-6 42 0 l0 34 q-24 10 -44-4 q-1-16 2-30 z',
  'hip-r': 'M144 188 q-22-6 -42 0 l0 34 q24 10 44-4 q1-16 -2-30 z',
};

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, v);
  }
  return node;
}

/**
 * @param {{ selected?: string[], onChange?: (ids:string[])=>void }} opts
 * @returns {{ el: SVGElement, get: ()=>string[] }}
 */
export function createBodyMap(opts = {}) {
  const selected = new Set(opts.selected || []);

  const svg = svgEl('svg', {
    viewBox: '0 0 200 260', width: '200', class: 'body-map',
    role: 'group', 'aria-label': 'Where does it hurt? Back view — your left is on the left.',
  });

  // Figure outline (decorative): head + torso silhouette behind the regions.
  svg.appendChild(svgEl('circle', { cx: 100, cy: 22, r: 15, class: 'body-map__outline' }));
  svg.appendChild(svgEl('path', {
    class: 'body-map__outline',
    d: 'M62 58 Q100 46 138 58 Q166 66 162 96 L146 142 Q150 176 146 190 Q148 226 128 236 Q100 246 72 236 Q52 226 54 190 Q50 176 54 142 L38 96 Q34 66 62 58 Z',
  }));
  // Spine hint.
  svg.appendChild(svgEl('line', { x1: 100, y1: 40, x2: 100, y2: 186, class: 'body-map__spine' }));

  function toggle(id, shape) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    shape.classList.toggle('body-map__region--on', selected.has(id));
    shape.setAttribute('aria-checked', selected.has(id) ? 'true' : 'false');
    if (opts.onChange) opts.onChange([...selected]);
  }

  for (const r of REGIONS) {
    const shape = svgEl('path', {
      d: SHAPES[r.id],
      class: 'body-map__region' + (selected.has(r.id) ? ' body-map__region--on' : ''),
      role: 'checkbox',
      tabindex: '0',
      'aria-checked': selected.has(r.id) ? 'true' : 'false',
      'aria-label': regionLabel(r.id),
    });
    const title = svgEl('title');
    title.textContent = regionLabel(r.id);
    shape.appendChild(title);
    shape.addEventListener('click', () => toggle(r.id, shape));
    shape.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(r.id, shape); }
    });
    svg.appendChild(shape);
  }

  return { el: svg, get: () => [...selected] };
}
