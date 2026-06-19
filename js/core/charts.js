// charts.js — dependency-free SVG data-viz. We deliberately don't vendor a
// charting library: the data volume is tiny (a few daily numbers), and a small
// inline SVG keeps the app fully offline, themeable via our CSS tokens, and
// free of a heavy dependency that could rot over the years this app must last.
//
// All charts return an <svg> element with a viewBox and width:100% so they
// scale to their container. Colors come from CSS variables so they re-theme
// with light/dark automatically.

const SVGNS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, v);
  }
  return node;
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

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    width: '100%',
    height: H,
    role: 'img',
    'aria-label': ariaLabel,
    class: 'chart chart--line',
    preserveAspectRatio: 'none',
  });

  // horizontal gridlines + y labels
  for (let t = 0; t <= yTicks; t++) {
    const val = yMin + ((yMax - yMin) * t) / yTicks;
    const y = yAt(val);
    svg.appendChild(svgEl('line', {
      x1: padL, x2: W - padR, y1: y, y2: y,
      stroke: 'var(--color-border)', 'stroke-width': 1,
    }));
    const lbl = svgEl('text', {
      x: padL - 6, y: y + 3, 'text-anchor': 'end',
      'font-size': 10, fill: 'var(--color-text-faint)',
    });
    lbl.textContent = Number.isInteger(val) ? val : val.toFixed(0);
    svg.appendChild(lbl);
  }

  // x labels (only where provided & non-empty)
  labels.forEach((label, i) => {
    if (!label) return;
    const txt = svgEl('text', {
      x: xAt(i), y: H - 8, 'text-anchor': 'middle',
      'font-size': 10, fill: 'var(--color-text-faint)',
    });
    txt.textContent = label;
    svg.appendChild(txt);
  });

  // each series: build a path, skipping null gaps; draw dots on real points
  for (const s of series) {
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
        const area = svgEl('path', {
          d: `${d}L${xAt(last).toFixed(1)},${yAt(yMin).toFixed(1)} L${xAt(first).toFixed(1)},${yAt(yMin).toFixed(1)} Z`,
          fill: s.color, opacity: 0.12, stroke: 'none',
        });
        svg.appendChild(area);
      }
    }
    svg.appendChild(svgEl('path', {
      d: d.trim(), fill: 'none', stroke: s.color,
      'stroke-width': s.dashed ? 2 : 2.5,
      'stroke-dasharray': s.dashed ? '5 4' : null,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
    if (!s.dashed) {
      s.values.forEach((v, i) => {
        if (v == null) return;
        svg.appendChild(svgEl('circle', { cx: xAt(i), cy: yAt(v), r: 2.5, fill: s.color }));
      });
    }
  }

  return svg;
}

/**
 * Simple vertical bar chart (e.g. weekly water/steps).
 * @param {{ values:number[], labels?:string[], goal?:number, color?:string,
 *           height?:number, ariaLabel?:string }} opts
 */
export function barChart(opts) {
  const {
    values = [],
    labels = [],
    goal = null,
    color = 'var(--color-primary)',
    height = 160,
    ariaLabel = 'Bar chart',
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
  const max = Math.max(goal || 0, ...values, 1);
  const slot = plotW / n;
  const barW = Math.min(slot * 0.6, 48);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', height: H,
    role: 'img', 'aria-label': ariaLabel, class: 'chart chart--bar',
  });

  if (goal) {
    const gy = padT + plotH * (1 - goal / max);
    svg.appendChild(svgEl('line', {
      x1: padL, x2: W - padR, y1: gy, y2: gy,
      stroke: 'var(--color-accent)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
    }));
  }

  values.forEach((v, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    const h = plotH * (Math.min(v, max) / max);
    const y = padT + plotH - h;
    const met = goal != null && v >= goal;
    svg.appendChild(svgEl('rect', {
      x, y, width: barW, height: Math.max(h, 1), rx: 4,
      fill: met ? color : 'var(--color-border-strong)',
    }));
    if (labels[i]) {
      const txt = svgEl('text', {
        x: x + barW / 2, y: H - 7, 'text-anchor': 'middle',
        'font-size': 10, fill: 'var(--color-text-faint)',
      });
      txt.textContent = labels[i];
      svg.appendChild(txt);
    }
  });

  return svg;
}

/**
 * Circular progress ring with centered value.
 * @param {{ value:number, max:number, size?:number, stroke?:number,
 *           color?:string, label:string, center?:string, sub?:string }} opts
 */
export function progressRing(opts) {
  const {
    value, max, size = 132, stroke = 12,
    color = 'var(--color-primary)', label = '', center = '', sub = '',
  } = opts;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const cx = size / 2;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${size} ${size}`, width: size, height: size,
    role: 'img', 'aria-label': `${label}: ${Math.round(pct * 100)} percent`,
    class: 'ring',
  });
  svg.appendChild(svgEl('circle', {
    cx, cy: cx, r, fill: 'none', stroke: 'var(--color-surface-2)', 'stroke-width': stroke,
  }));
  svg.appendChild(svgEl('circle', {
    cx, cy: cx, r, fill: 'none', stroke: color, 'stroke-width': stroke,
    'stroke-linecap': 'round', 'stroke-dasharray': c,
    'stroke-dashoffset': c * (1 - pct),
    transform: `rotate(-90 ${cx} ${cx})`,
  }));
  const big = svgEl('text', {
    x: cx, y: cx - 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
    'font-size': 22, 'font-weight': 700, fill: 'var(--color-text)',
  });
  big.textContent = center;
  svg.appendChild(big);
  if (sub) {
    const small = svgEl('text', {
      x: cx, y: cx + 18, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
      'font-size': 11, fill: 'var(--color-text-muted)',
    });
    small.textContent = sub;
    svg.appendChild(small);
  }
  return svg;
}
