// ui.js — DOM helpers + the shared component kit ("Steady"). Deliberately
// framework-free: enough to build views declaratively, now including skeletons,
// empty states, native <dialog> flows, segmented controls, toasts and tiles.

import { icon } from './icons.js';
import { sparkline } from './charts.js';

/** querySelector / querySelectorAll sugar. */
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Remove all children of a node. */
export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Append children (strings/numbers become text nodes; arrays are flattened). */
export function mount(node, ...children) {
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    const isText = typeof child === 'string' || typeof child === 'number';
    node.appendChild(isText ? document.createTextNode(String(child)) : child);
  }
  return node;
}

/**
 * Create an element.
 *   el('button', { class: 'btn', onClick: fn, 'aria-label': 'x' }, 'Save')
 * Attribute conventions:
 *   - `class` / `className`  → className
 *   - `dataset: {a: 1}`      → data-* attributes
 *   - `style: {color:'red'}` → inline styles
 *   - onXxx function         → addEventListener('xxx')
 *   - other values           → setAttribute (false/null/undefined skipped)
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = value;
    } else if (key === 'dataset') {
      for (const [d, v] of Object.entries(value)) node.dataset[d] = v;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'html') {
      node.innerHTML = value; // only ever called with app-controlled strings
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, value);
    }
  }
  mount(node, ...children);
  return node;
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// --- toast (v2) ------------------------------------------------------------
// Type-aware durations, icons, pause-on-hover, max 3 on screen. Errors are
// role=alert so screen readers announce them assertively.

const TOAST_DURATION = { info: 4000, success: 4000, warn: 6000, error: 8000 };
const TOAST_ICON = { info: 'info', success: 'check', warn: 'alert-triangle', error: 'alert-triangle' };
const TOAST_MAX = 3;

function toastContainer() {
  let c = qs('#toast-container');
  if (!c) {
    c = el('div', { id: 'toast-container', class: 'toast-container', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.appendChild(c);
  }
  return c;
}

/**
 * Show a transient message.
 * @param {string} message
 * @param {{ type?: 'info'|'success'|'warn'|'error', duration?: number, action?: {label:string, onClick:Function} }} [opts]
 */
export function toast(message, opts = {}) {
  const { type = 'info', action } = opts;
  const duration = opts.duration != null ? opts.duration : (TOAST_DURATION[type] || 4000);
  const node = el('div', {
    class: `toast toast--${type}`,
    role: type === 'error' ? 'alert' : 'status',
  },
    el('span', { class: 'toast__icon', 'aria-hidden': 'true' }, icon(TOAST_ICON[type] || 'info', { size: 18 })),
    el('span', { class: 'toast__msg' }, message)
  );

  if (action) {
    node.appendChild(
      el('button', {
        class: 'toast__action',
        onClick: () => {
          action.onClick();
          dismiss();
        },
      }, action.label)
    );
  }
  node.appendChild(el('button', { class: 'toast__close', 'aria-label': 'Dismiss', onClick: () => dismiss() }, '×'));

  let timer = null;
  let remaining = duration;
  let startedAt = 0;
  function arm(ms) {
    startedAt = Date.now();
    timer = setTimeout(dismiss, ms);
  }
  function dismiss() {
    if (timer) { clearTimeout(timer); timer = null; }
    node.classList.add('toast--leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    // Fallback removal in case animations are disabled (reduced-motion).
    setTimeout(() => node.remove(), 400);
  }
  // Pause the clock while hovered — the user is reading.
  node.addEventListener('mouseenter', () => {
    if (timer) { clearTimeout(timer); timer = null; remaining -= Date.now() - startedAt; }
  });
  node.addEventListener('mouseleave', () => {
    if (!timer && remaining > 0) arm(Math.max(remaining, 800));
  });

  const container = toastContainer();
  // Cap concurrent toasts; drop the oldest so the newest is always visible.
  while (container.children.length >= TOAST_MAX) container.firstChild.remove();
  container.appendChild(node);
  if (duration > 0) arm(duration);
  return { dismiss };
}

/** Convenience: a labelled section card used across views. */
export function card(title, ...children) {
  return el('section', { class: 'card' }, title ? el('h2', { class: 'card__title' }, title) : null, ...children);
}

/** View header with title, optional subtitle and right-aligned actions. */
export function pageHeader(opts) {
  const { title, sub, actions } = typeof opts === 'string' ? { title: opts } : (opts || {});
  return el('div', { class: 'view-header' },
    el('div', { class: 'view-header__text' },
      el('h1', {}, title || ''),
      sub ? el('p', {}, sub) : null
    ),
    actions && actions.length ? el('div', { class: 'view-header__actions' }, ...actions) : null
  );
}

// --- loading / empty ---------------------------------------------------------

/** Shimmering placeholder lines shown while content loads. */
export function skeleton({ lines = 3, height } = {}) {
  const block = el('div', { class: 'skeleton', 'aria-hidden': 'true' });
  for (let i = 0; i < lines; i++) {
    block.appendChild(el('div', {
      class: 'skeleton__line',
      style: height ? { height } : (i === lines - 1 ? { width: '60%' } : null),
    }));
  }
  return block;
}

/** A grid of tile-shaped skeletons (dashboard/list loading). */
export function skeletonGrid(count = 4) {
  return el('div', { class: 'grid', 'aria-hidden': 'true' },
    ...Array.from({ length: count }, () => el('div', { class: 'skeleton skeleton--tile' },
      el('div', { class: 'skeleton__line', style: { width: '40%' } }),
      el('div', { class: 'skeleton__line', style: { height: '28px', width: '55%' } }),
      el('div', { class: 'skeleton__line', style: { width: '70%' } })
    ))
  );
}

/**
 * Friendly empty state.
 * @param {{ icon?: string, title: string, body?: string, action?: HTMLElement }} opts
 */
export function emptyState(opts) {
  const { icon: iconName, title, body, action } = opts;
  return el('div', { class: 'empty' },
    iconName ? el('div', { class: 'empty__icon' }, icon(iconName, { size: 36 })) : null,
    el('div', { class: 'empty__title' }, title),
    body ? el('p', {}, body) : null,
    action ? el('div', { class: 'empty__action' }, action) : null
  );
}

// --- dialogs -----------------------------------------------------------------
// Native <dialog>: focus trapping, Esc-to-cancel and ::backdrop for free.
// Renders as a centered card ≥720px and a bottom sheet below (see CSS).

/**
 * Open a modal dialog.
 * @param {{ title?: string, content?: any, actions?: HTMLElement[],
 *           className?: string, onClose?: (value:any)=>void }} opts
 * @returns {{ dialog: HTMLDialogElement, close: (value?:any)=>void }}
 */
export function openDialog(opts = {}) {
  const { title, content, actions, className, onClose } = opts;
  const returnFocusTo = document.activeElement;

  const dialog = el('dialog', { class: 'dialog' + (className ? ' ' + className : '') });
  const closeBtn = el('button', { class: 'dialog__close', 'aria-label': 'Close', onClick: () => close() }, icon('x', { size: 20 }));
  const body = el('div', { class: 'dialog__body' });
  mount(body, content);

  mount(dialog,
    el('div', { class: 'dialog__head' },
      title ? el('h2', { class: 'dialog__title' }, title) : el('span', {}),
      closeBtn
    ),
    body,
    actions && actions.length ? el('div', { class: 'dialog__actions' }, ...actions) : null
  );

  let closed = false;
  function close(value) {
    if (closed) return;
    closed = true;
    try { dialog.close(); } catch (_) { /* already closed */ }
    dialog.remove();
    if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
      try { returnFocusTo.focus(); } catch (_) { /* gone */ }
    }
    if (onClose) onClose(value);
  }

  // Esc → 'cancel' → treat as close; backdrop click also closes.
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });

  document.body.appendChild(dialog);
  dialog.showModal();
  return { dialog, close };
}

/**
 * Confirmation dialog. Resolves true only on explicit confirm.
 * @param {{ title: string, body?: string, confirmLabel?: string,
 *           cancelLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts) {
  const { title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = opts;
  return new Promise((resolve) => {
    let result = false;
    const confirm = el('button', {
      class: 'btn ' + (danger ? 'btn--danger' : 'btn--primary'),
      onClick: () => { result = true; handle.close(); },
    }, confirmLabel);
    const cancel = el('button', { class: 'btn btn--ghost', onClick: () => handle.close() }, cancelLabel);
    const handle = openDialog({
      title,
      content: body ? el('p', { class: 'dialog__text' }, body) : null,
      actions: [cancel, confirm],
      onClose: () => resolve(result),
    });
    confirm.focus();
  });
}

// --- segmented control ---------------------------------------------------------
// Radio-group semantics with a pill visual — keyboard and SR behaviour for free.

let segmentedSeq = 0;

/**
 * @param {{ options: {value:string, label:string, icon?:string}[],
 *           value?: string, name?: string, ariaLabel?: string,
 *           onChange?: (value:string)=>void }} opts
 * @returns {{ root: HTMLElement, get: ()=>string, set: (v:string)=>void }}
 */
export function segmented(opts) {
  const { options = [], value, ariaLabel, onChange } = opts;
  const name = opts.name || `seg-${++segmentedSeq}`;
  const root = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': ariaLabel || null });
  const inputs = [];
  for (const o of options) {
    const input = el('input', {
      class: 'segmented__input', type: 'radio', name, value: o.value,
      checked: o.value === value,
      onChange: () => { if (onChange) onChange(o.value); },
    });
    inputs.push(input);
    root.appendChild(el('label', { class: 'segmented__opt' },
      input,
      el('span', { class: 'segmented__face' },
        o.icon ? icon(o.icon, { size: 16 }) : null,
        el('span', {}, o.label))
    ));
  }
  return {
    root,
    get: () => { const c = inputs.find((i) => i.checked); return c ? c.value : undefined; },
    set: (v) => { for (const i of inputs) i.checked = i.value === v; },
  };
}

// --- form validation ------------------------------------------------------------

/**
 * Attach/clear an inline error on a .field wrapper. Pass null to clear.
 * Adds aria-invalid + aria-describedby to the field's input when present.
 */
export function setFieldError(fieldEl, message) {
  if (!fieldEl) return;
  let err = fieldEl.querySelector(':scope > .field__error');
  const input = fieldEl.querySelector('input, select, textarea');
  if (!message) {
    fieldEl.classList.remove('field--error');
    if (err) err.remove();
    if (input) { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
    return;
  }
  fieldEl.classList.add('field--error');
  if (!err) {
    err = el('span', { class: 'field__error', role: 'alert' });
    fieldEl.appendChild(err);
  }
  err.textContent = message;
  if (input) {
    if (!err.id) err.id = `err-${++segmentedSeq}`;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', err.id);
  }
}

// --- celebration -----------------------------------------------------------------

/**
 * A small CSS bloom of particles — for streak increments and 100% goals.
 * No-op under prefers-reduced-motion.
 * @param {HTMLElement} [originEl] burst from this element's center (else viewport center)
 */
export function celebrate(originEl) {
  if (reducedMotion()) return;
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  if (originEl && originEl.getBoundingClientRect) {
    const r = originEl.getBoundingClientRect();
    if (r.width || r.height) { x = r.left + r.width / 2; y = r.top + r.height / 2; }
  }
  const host = el('div', { class: 'bloom', 'aria-hidden': 'true', style: { left: x + 'px', top: y + 'px' } });
  const colors = ['var(--color-primary)', 'var(--color-accent)', 'var(--color-water)', 'var(--violet-400)'];
  const COUNT = 14;
  for (let i = 0; i < COUNT; i++) {
    const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = 44 + Math.random() * 46;
    host.appendChild(el('span', {
      class: 'bloom__p',
      style: {
        background: colors[i % colors.length],
        '--dx': `${Math.cos(angle) * dist}px`,
        '--dy': `${Math.sin(angle) * dist}px`,
        '--delay': `${Math.random() * 80}ms`,
      },
    }));
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 1100);
}

// --- slider (v2) --------------------------------------------------------------
// Filled track + optional anchor labels under the ends/middle.

/**
 * Labelled range slider with a live value read-out.
 * @param {{ id?:string, label:string, min:number, max:number, step?:number,
 *           value:number, format?:(v:number)=>string, onInput?:(v:number)=>void,
 *           anchors?: string[] }} opts
 * @returns {{ field:HTMLElement, input:HTMLInputElement, get:()=>number, set:(v:number)=>void }}
 */
export function slider(opts) {
  const { id, label, min, max, step = 1, value, format = (v) => v, onInput, anchors } = opts;
  const out = el('output', { class: 'slider__value' }, String(format(value)));
  const input = el('input', {
    class: 'slider', type: 'range', min, max, step, value, id,
    'aria-label': label,
    onInput: (e) => {
      const v = Number(e.target.value);
      out.textContent = String(format(v));
      paintFill(v);
      if (onInput) onInput(v);
    },
  });
  function paintFill(v) {
    const pct = ((v - min) / (max - min || 1)) * 100;
    input.style.setProperty('--slider-fill', pct + '%');
  }
  paintFill(value);
  const field = el('div', { class: 'field slider-field' },
    el('div', { class: 'row row--between' },
      el('label', { for: id }, label),
      out
    ),
    input,
    anchors && anchors.length ? el('div', { class: 'slider__anchors', 'aria-hidden': 'true' },
      ...anchors.map((a) => el('span', {}, a))) : null
  );
  return {
    field,
    input,
    get: () => Number(input.value),
    set: (v) => { input.value = v; out.textContent = String(format(v)); paintFill(v); },
  };
}

// --- stat tile (v2) --------------------------------------------------------------
// DOM order is label → value → sub so screen readers announce the metric name
// before its number. Optional sparkline and delta chip.

/**
 * Compact stat tile for the dashboard. Clickable if onClick/href is provided.
 * @param {{ label:string, value:string, sub?:string, accent?:string,
 *           icon?:string, iconName?:string, onClick?:Function, href?:string,
 *           spark?: (number|null)[], sparkColor?: string,
 *           delta?: { text:string, dir?:'up'|'down'|'flat', good?:boolean } }} opts
 */
export function statTile(opts) {
  const { label, value, sub, accent, icon: emoji, iconName, onClick, href, spark, sparkColor, delta } = opts;
  const iconNode = iconName
    ? el('div', { class: 'tile__icon', 'aria-hidden': 'true' }, icon(iconName, { size: 20 }))
    : emoji ? el('div', { class: 'tile__icon', 'aria-hidden': 'true' }, emoji) : null;

  let deltaNode = null;
  if (delta && delta.text) {
    const dir = delta.dir || 'flat';
    const tone = delta.good == null ? 'neutral' : delta.good ? 'good' : 'bad';
    deltaNode = el('span', { class: `tile__delta tile__delta--${tone}` },
      dir !== 'flat' ? icon(dir === 'up' ? 'trending-up' : 'trending-down', { size: 14 }) : null,
      delta.text);
  }

  const body = [
    el('div', { class: 'tile__top' },
      el('div', { class: 'tile__label' }, label),
      iconNode
    ),
    el('div', { class: 'tile__value', style: accent ? { color: accent } : null }, value),
    (sub || deltaNode) ? el('div', { class: 'tile__foot' },
      sub ? el('span', { class: 'tile__sub' }, sub) : null,
      deltaNode
    ) : null,
    spark && spark.some((v) => v != null)
      ? el('div', { class: 'tile__spark', 'aria-hidden': 'true' },
          sparkline({ values: spark, color: sparkColor || accent || 'var(--color-primary)' }))
      : null,
  ];
  if (href) return el('a', { class: 'tile tile--link', href }, ...body);
  if (onClick) return el('button', { class: 'tile tile--link', onClick }, ...body);
  return el('div', { class: 'tile' }, ...body);
}
