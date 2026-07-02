// charts.js — dependency-free SVG data-viz. We deliberately don't vendor a
// charting library: the data volume is tiny (a few daily numbers), and a small
// inline SVG keeps the app fully offline, themeable via our CSS tokens, and
// free of a heavy dependency that could rot over the years this app must last.
//
// v2: optional nearest-point tooltips (`interactive`), draw-in animation
// (`animate`, dead under reduced-motion), gradient area fills, 'auto' markers,
// sparklines for tiles, screen-reader data tables, and an updatable ring for
// live values (camera posture score). All charts return an <svg> element with
// a viewBox and width:100% so they scale to their container; colors come from
// CSS variables so they re-theme with light/dark automatically.

const SVGNS = 'http://www.w3.org/2000/svg';
let uid = 0;

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, v);
  }
  return node;
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function fmt(v) {
  if (v == null || Number.isNaN(v)) return '–';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

/** Enable draw-in on a path: normalized dash trick, no measuring needed. */
function drawIn(path, delayMs = 0) {
  if (reducedMotion()) return;
  path.setAttribute('pathLength', '1');
  path.classList.add('chart__draw');
  if (delayMs) path.style.animationDelay = `${delayMs}ms`;
}

/**
 * Multi-series line chart.
 * @param {{
 *   series: {values:(number|null)[], color:string, label?:string, dashed?:boolean, fill?:boolean}[],
 *   labels?: string[],          // x-axis tick labels (sparse ok)
 *   yMin?: number, yMax?: number,
 *   yTicks?: number,            // number of horizontal gridlines
 *   height?: number,
 *   ariaLabel?: string,
 *   interactive?: boolean,      // nearest-point tooltip on hover/touch
 *   animate?: boolean,          // draw lines in on first paint
 *   gradientFill?: boolean,     // area fills fade to transparent
 *   markers?: true|'auto',      // 'auto' = only first/last/min/max dots
 *   tipFormat?: (v:number)=>string,
 * }} opts
 * @returns {SVGElement}
 */
export function lineChart(opts) {
  const {
    series = [],
    labels = [],
    yMin = 0,
    yMax = 10,
    yTicks = 5,
    height = 220,
    ariaLabel = 'Line chart',
    interactive = false,
    animate = false,
    gradientFill = false,
    markers = true,
    tipFormat = fmt,
  } = opts;

  const W = 600; // viewBox width; scales via width:100%
  const H = height;
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = Math.max(1, Math.max(...series.map((s) => s.values.length), labels.length));
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const yAt = (v) => padT + plotH * (1 - (v - yMin) / (yMax - yMin || 1));

  // width:100% + intrinsic viewBox ratio (no fixed pixel height, default
  // preserveAspectRatio) → uniform scaling, so dots stay round at any width.
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    role: 'img',
    'aria-label': ariaLabel,
    class: 'chart chart--line',
  });

  // horizontal gridlines + y labels (styled via classes for dark/print CSS)
  for (let t = 0; t <= yTicks; t++) {
    const val = yMin + ((yMax - yMin) * t) / yTicks;
    const y = yAt(val);
    svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'chart__grid' }));
    const lbl = svgEl('text', { x: padL - 6, y: y + 3, 'text-anchor': 'end', 'font-size': 10, class: 'chart__tick' });
    lbl.textContent = Number.isInteger(val) ? val : val.toFixed(0);
    svg.appendChild(lbl);
  }

  // x labels (only where provided & non-empty)
  labels.forEach((label, i) => {
    if (!label) return;
    const txt = svgEl('text', { x: xAt(i), y: H - 8, 'text-anchor': 'middle', 'font-size': 10, class: 'chart__tick' });
    txt.textContent = label;
    svg.appendChild(txt);
  });

  // each series: build a path, skipping null gaps; draw dots on real points
  series.forEach((s, si) => {
    let d = '';
    let penDown = false;
    s.values.forEach((v, i) => {
      if (v == null) { penDown = false; return; }
      const cmd = penDown ? 'L' : 'M';
      d += `${cmd}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)} `;
      penDown = true;
    });
    if (s.fill && d) {
      // area fill under the line
      const first = s.values.findIndex((v) => v != null);
      const last = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v != null);
      if (first >= 0) {
        let fill = s.color;
        let opacity = 0.12;
        if (gradientFill) {
          const gid = `chart-grad-${++uid}`;
          const defs = svgEl('defs');
          const grad = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
          const stop1 = svgEl('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': 0.26 });
          const stop2 = svgEl('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0 });
          grad.append(stop1, stop2);
          defs.appendChild(grad);
          svg.appendChild(defs);
          fill = `url(#${gid})`;
          opacity = 1;
        }
        const area = svgEl('path', {
          d: `${d}L${xAt(last).toFixed(1)},${yAt(yMin).toFixed(1)} L${xAt(first).toFixed(1)},${yAt(yMin).toFixed(1)} Z`,
          fill, opacity, stroke: 'none', class: 'chart__area',
        });
        if (animate && !reducedMotion()) area.classList.add('chart__fade');
        svg.appendChild(area);
      }
    }
    const path = svgEl('path', {
      d: d.trim(), fill: 'none', stroke: s.color,
      'stroke-width': s.dashed ? 2 : 2.5,
      'stroke-dasharray': s.dashed ? '5 4' : null,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    });
    // Draw-in uses the dash channel, so dashed series keep their static style.
    if (animate && !s.dashed) drawIn(path, si * 120);
    svg.appendChild(path);

    if (!s.dashed) {
      const real = s.values.map((v, i) => (v == null ? null : i)).filter((i) => i != null);
      let dotIdx = real;
      if (markers === 'auto' && real.length > 14) {
        let minI = real[0], maxI = real[0];
        for (const i of real) {
          if (s.values[i] < s.values[minI]) minI = i;
          if (s.values[i] > s.values[maxI]) maxI = i;
        }
        dotIdx = [...new Set([real[0], real[real.length - 1], minI, maxI])];
      }
      for (const i of dotIdx) {
        svg.appendChild(svgEl('circle', { cx: xAt(i), cy: yAt(s.values[i]), r: 2.5, fill: s.color, class: 'chart__dot' }));
      }
    }
  });

  if (interactive && n > 1) attachLineTooltip(svg, { series, labels, xAt, yAt, n, W, H, padT, plotH, tipFormat });

  appendAriaSummary(svg, describeSeries(series, ariaLabel));
  return svg;
}

/** Hover/touch tooltip: nearest x index, all series values at that point. */
function attachLineTooltip(svg, ctx) {
  const { series, labels, xAt, yAt, n, W, padT, plotH, tipFormat } = ctx;
  const tip = svgEl('g', { class: 'chart__tip', visibility: 'hidden' });
  const vline = svgEl('line', { y1: padT, y2: padT + plotH, class: 'chart__tipline' });
  const box = svgEl('rect', { rx: 6, class: 'chart__tipbox' });
  const txt = svgEl('text', { 'font-size': 11, class: 'chart__tiptext' });
  const dots = series.map((s) => {
    const c = svgEl('circle', { r: 3.5, fill: s.color, stroke: 'var(--color-surface)', 'stroke-width': 1.5 });
    tip.appendChild(c);
    return c;
  });
  tip.prepend(vline);
  tip.append(box, txt);
  svg.appendChild(tip);

  function show(clientX) {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xAt(i) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    const x = xAt(best);
    vline.setAttribute('x1', x); vline.setAttribute('x2', x);

    const lines = [];
    if (labels[best]) lines.push({ text: labels[best], head: true });
    series.forEach((s, si) => {
      const v = s.values[best];
      if (v == null) { dots[si].setAttribute('visibility', 'hidden'); return; }
      dots[si].setAttribute('visibility', 'visible');
      dots[si].setAttribute('cx', x); dots[si].setAttribute('cy', yAt(v));
      lines.push({ text: `${s.label ? s.label + ' ' : ''}${tipFormat(v)}` });
    });
    if (!lines.length) { tip.setAttribute('visibility', 'hidden'); return; }

    while (txt.firstChild) txt.removeChild(txt.firstChild);
    const boxW = Math.max(...lines.map((l) => l.text.length)) * 6.4 + 16;
    const boxH = lines.length * 14 + 10;
    const left = x + 10 + boxW > W ? x - 10 - boxW : x + 10;
    const top = padT + 4;
    box.setAttribute('x', left); box.setAttribute('y', top);
    box.setAttribute('width', boxW); box.setAttribute('height', boxH);
    lines.forEach((l, li) => {
      const t = svgEl('tspan', { x: left + 8, y: top + 16 + li * 14, 'font-weight': l.head ? 600 : null });
      t.textContent = l.text;
      txt.appendChild(t);
    });
    tip.setAttribute('visibility', 'visible');
  }

  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', () => tip.setAttribute('visibility', 'hidden'));
}

/**
 * Simple vertical bar chart (e.g. weekly water/steps).
 * @param {{ values:number[], labels?:string[], goal?:number, color?:string,
 *           height?:number, ariaLabel?:string, interactive?:boolean,
 *           animate?:boolean, tipFormat?:(v:number)=>string }} opts
 */
export function barChart(opts) {
  const {
    values = [],
    labels = [],
    goal = null,
    color = 'var(--color-primary)',
    height = 160,
    ariaLabel = 'Bar chart',
    interactive = false,
    animate = false,
    tipFormat = fmt,
  } = opts;

  const W = 600;
  const H = height;
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = Math.max(1, values.length);
  const max = Math.max(goal || 0, ...values.filter((v) => v != null), 1);
  const slot = plotW / n;
  const barW = Math.min(slot * 0.6, 48);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%',
    role: 'img', 'aria-label': ariaLabel, class: 'chart chart--bar',
  });

  if (goal) {
    const gy = padT + plotH * (1 - goal / max);
    svg.appendChild(svgEl('line', {
      x1: padL, x2: W - padR, y1: gy, y2: gy, class: 'chart__goal',
      stroke: 'var(--color-accent)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
    }));
  }

  let tipShow = null;
  values.forEach((v, i) => {
    const val = v == null ? 0 : v;
    const x = padL + i * slot + (slot - barW) / 2;
    const h = plotH * (Math.min(val, max) / max);
    const y = padT + plotH - h;
    const met = goal != null && val >= goal;
    const bar = svgEl('rect', {
      x, y, width: barW, height: Math.max(h, 1), rx: 4,
      fill: met ? color : 'var(--color-border-strong)',
      class: 'chart__bar',
    });
    if (animate && !reducedMotion()) {
      bar.classList.add('chart__grow');
      bar.style.transformOrigin = `${x + barW / 2}px ${padT + plotH}px`;
      bar.style.animationDelay = `${i * 30}ms`;
    }
    if (interactive) {
      bar.addEventListener('pointerenter', () => tipShow && tipShow(i, x + barW / 2, y));
      bar.addEventListener('pointerdown', () => tipShow && tipShow(i, x + barW / 2, y));
    }
    svg.appendChild(bar);
    if (labels[i]) {
      const txt = svgEl('text', { x: x + barW / 2, y: H - 7, 'text-anchor': 'middle', 'font-size': 10, class: 'chart__tick' });
      txt.textContent = labels[i];
      svg.appendChild(txt);
    }
  });

  if (interactive) {
    const tip = svgEl('g', { class: 'chart__tip', visibility: 'hidden' });
    const box = svgEl('rect', { rx: 6, class: 'chart__tipbox' });
    const txt = svgEl('text', { 'font-size': 11, class: 'chart__tiptext' });
    tip.append(box, txt);
    svg.appendChild(tip);
    tipShow = (i, cx, cy) => {
      const text = `${labels[i] ? labels[i] + ': ' : ''}${tipFormat(values[i] == null ? 0 : values[i])}`;
      txt.textContent = text;
      const w = text.length * 6.4 + 16;
      const left = Math.max(2, Math.min(W - w - 2, cx - w / 2));
      const top = Math.max(2, cy - 26);
      box.setAttribute('x', left); box.setAttribute('y', top);
      box.setAttribute('width', w); box.setAttribute('height', 20);
      txt.setAttribute('x', left + 8); txt.setAttribute('y', top + 14);
      tip.setAttribute('visibility', 'visible');
    };
    svg.addEventListener('pointerleave', () => tip.setAttribute('visibility', 'hidden'));
  }

  appendAriaSummary(svg, describeSeries([{ values, label: '' }], ariaLabel));
  return svg;
}

/**
 * Circular progress ring with centered value.
 * @param {{ value:number, max:number, size?:number, stroke?:number,
 *           color?:string, label:string, center?:string, sub?:string,
 *           animate?:boolean }} opts
 */
export function progressRing(opts) {
  return buildRing(opts).svg;
}

/**
 * A progress ring whose value/color/text can be updated in place — for live
 * readouts (camera posture score) without rebuilding the SVG each tick.
 * @returns {{ svg:SVGElement, set:(value:number, extra?:{max?:number,color?:string,center?:string,sub?:string})=>void }}
 */
export function updatableRing(opts) {
  return buildRing(opts);
}

function buildRing(opts) {
  const {
    value, max, size = 132, stroke = 12,
    color = 'var(--color-primary)', label = '', center = '', sub = '',
    animate = false,
  } = opts;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let curMax = max;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`, width: size, height: size,
    role: 'img', 'aria-label': ringAria(label, value, max),
    class: 'ring',
  });
  svg.appendChild(svgEl('circle', {
    cx, cy: cx, r, fill: 'none', stroke: 'var(--color-surface-2)', 'stroke-width': stroke,
  }));
  const fg = svgEl('circle', {
    cx, cy: cx, r, fill: 'none', stroke: color, 'stroke-width': stroke,
    'stroke-linecap': 'round', 'stroke-dasharray': c,
    'stroke-dashoffset': c,
    transform: `rotate(-90 ${cx} ${cx})`,
    class: animate && !reducedMotion() ? 'ring__fg ring__fg--animate' : 'ring__fg',
  });
  svg.appendChild(fg);
  const big = svgEl('text', {
    x: cx, y: cx - 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'font-size': 22, 'font-weight': 700, class: 'ring__center',
  });
  big.textContent = center;
  svg.appendChild(big);
  const small = svgEl('text', {
    x: cx, y: cx + 18, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'font-size': 11, class: 'ring__sub',
  });
  small.textContent = sub;
  svg.appendChild(small);

  function set(v, extra = {}) {
    if (extra.max != null) curMax = extra.max;
    const pct = curMax > 0 ? Math.min(Math.max(v / curMax, 0), 1) : 0;
    fg.setAttribute('stroke-dashoffset', c * (1 - pct));
    if (extra.color) fg.setAttribute('stroke', extra.color);
    if (extra.center != null) big.textContent = extra.center;
    if (extra.sub != null) small.textContent = extra.sub;
    svg.setAttribute('aria-label', ringAria(label, v, curMax));
  }
  set(value);
  return { svg, set };
}

function ringAria(label, value, max) {
  const pct = max > 0 ? Math.round(Math.min(value / max, 1) * 100) : 0;
  return `${label}: ${pct} percent`;
}

/**
 * Tiny inline trend line for stat tiles. Decorative (aria-hidden) — pair it
 * with real numbers in the tile text.
 * @param {{ values:(number|null)[], color?:string, height?:number }} opts
 */
export function sparkline(opts) {
  const { values = [], color = 'var(--color-primary)', height = 32 } = opts;
  const W = 120, H = height, pad = 3;
  const real = values.filter((v) => v != null);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', height: H,
    'aria-hidden': 'true', class: 'spark', preserveAspectRatio: 'none',
  });
  if (real.length < 2) return svg;
  const min = Math.min(...real);
  const max = Math.max(...real);
  const n = values.length;
  const xAt = (i) => pad + (i * (W - pad * 2)) / (n - 1);
  const yAt = (v) => pad + (H - pad * 2) * (1 - (v - min) / (max - min || 1));
  let d = '';
  let penDown = false;
  values.forEach((v, i) => {
    if (v == null) { penDown = false; return; }
    d += `${penDown ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)} `;
    penDown = true;
  });
  svg.appendChild(svgEl('path', {
    d: d.trim(), fill: 'none', stroke: color, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    'vector-effect': 'non-scaling-stroke',
  }));
  let lastI = -1;
  values.forEach((v, i) => { if (v != null) lastI = i; });
  if (lastI >= 0) {
    svg.appendChild(svgEl('circle', { cx: xAt(lastI), cy: yAt(values[lastI]), r: 2.5, fill: color }));
  }
  return svg;
}

/**
 * Visually-hidden data table mirroring a chart, for screen readers.
 * @param {{ caption:string, labels:string[], series:{label?:string, values:(number|null)[]}[] }} opts
 */
export function srTable(opts) {
  const { caption = 'Chart data', labels = [], series = [] } = opts;
  const table = document.createElement('table');
  table.className = 'visually-hidden';
  const cap = document.createElement('caption');
  cap.textContent = caption;
  table.appendChild(cap);
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.scope = 'col';
  th0.textContent = 'Day';
  hr.appendChild(th0);
  for (const s of series) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = s.label || 'Value';
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  labels.forEach((label, i) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label || `#${i + 1}`;
    tr.appendChild(th);
    for (const s of series) {
      const td = document.createElement('td');
      td.textContent = s.values[i] == null ? 'not logged' : String(s.values[i]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

/** Short spoken summary appended to a chart (in <desc>, joined to aria-label). */
function appendAriaSummary(svg, summary) {
  if (!summary) return;
  const desc = svgEl('desc');
  desc.textContent = summary;
  svg.insertBefore(desc, svg.firstChild);
  const base = svg.getAttribute('aria-label') || '';
  svg.setAttribute('aria-label', base ? `${base}. ${summary}` : summary);
}

function describeSeries(series, _label) {
  const parts = [];
  for (const s of series) {
    const real = (s.values || []).filter((v) => v != null);
    if (!real.length) continue;
    const latest = real[real.length - 1];
    const min = Math.min(...real);
    const max = Math.max(...real);
    parts.push(`${s.label ? s.label + ': ' : ''}latest ${fmt(latest)}, range ${fmt(min)} to ${fmt(max)} over ${real.length} points`);
  }
  return parts.join('; ');
}
