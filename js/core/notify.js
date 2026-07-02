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

// --- chime ------------------------------------------------------------------
// A soft two-note WebAudio chime (opt-in, used by the camera alert ladder).
// No audio assets; a couple of sine oscillators with a gentle envelope.
let audioCtx = null;

export function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const t0 = audioCtx.currentTime;
    const note = (freq, at, dur) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.12, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    };
    note(660, 0, 0.28); // E5
    note(880, 0.16, 0.34); // A5
    return true;
  } catch (_) {
    return false;
  }
}
