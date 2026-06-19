// ui.js — small DOM helpers shared by every view. Deliberately tiny: enough to
// build views declaratively without a framework, plus the toast used as the
// in-app fallback when browser notifications are denied (Phase 2 wires that up).

/** querySelector / querySelectorAll sugar. */
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Remove all children of a node. */
export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Append children (strings become text nodes; arrays are flattened). */
export function mount(node, ...children) {
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
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

// --- toast ---------------------------------------------------------------
// Lives in #toast-container (an aria-live region in index.html). Used as the
// graceful fallback for reminders when Notification permission is denied.

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
  const { type = 'info', duration = 4000, action } = opts;
  const node = el('div', { class: `toast toast--${type}`, role: 'status' }, el('span', { class: 'toast__msg' }, message));

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
  const close = el('button', { class: 'toast__close', 'aria-label': 'Dismiss', onClick: () => dismiss() }, '×');
  node.appendChild(close);

  let timer = null;
  function dismiss() {
    if (timer) clearTimeout(timer);
    node.classList.add('toast--leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    // Fallback removal in case animations are disabled (reduced-motion).
    setTimeout(() => node.remove(), 400);
  }

  toastContainer().appendChild(node);
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return { dismiss };
}

/** Convenience: a labelled section card used across views. */
export function card(title, ...children) {
  return el('section', { class: 'card' }, title ? el('h2', { class: 'card__title' }, title) : null, ...children);
}
