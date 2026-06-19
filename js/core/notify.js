// notify.js — browser notifications with a graceful in-app toast fallback.
// Notifications only work while the tab is open and are unreliable when it's
// backgrounded; that limitation is stated honestly in the UI. When permission
// is denied or unavailable, we fall back to a toast so a reminder is never
// silently lost while the user is looking at the app.

import { toast } from './ui.js';

export function isSupported() {
  return typeof Notification !== 'undefined';
}

export function permission() {
  return isSupported() ? Notification.permission : 'unsupported';
}

export function canNotify() {
  return isSupported() && Notification.permission === 'granted';
}

/** Ask for permission. Returns the resulting state ('granted'|'denied'|...). */
export async function requestPermission() {
  if (!isSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch (_) {
    return Notification.permission;
  }
}

/**
 * Fire a reminder. Uses a real notification if granted, otherwise a toast.
 * @param {string} title
 * @param {{ body?:string, type?:string, onClick?:Function, toastDuration?:number }} [opts]
 */
export function fire(title, opts = {}) {
  const { body = '', type = 'info', onClick, toastDuration = 8000 } = opts;
  if (canNotify()) {
    try {
      const n = new Notification(title, { body, tag: 'upright-reminder', renotify: true });
      if (onClick) {
        n.onclick = () => { window.focus(); onClick(); n.close(); };
      }
      return { via: 'notification' };
    } catch (_) {
      /* fall through to toast */
    }
  }
  toast(`${title}${body ? ' — ' + body : ''}`, { type, duration: toastDuration, action: onClick ? { label: 'Open', onClick } : undefined });
  return { via: 'toast' };
}
