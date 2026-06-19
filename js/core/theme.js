// theme.js — apply the user's theme preference. 'system' follows the OS via
// the prefers-color-scheme media query (default); 'light'/'dark' force it via
// a data-theme attribute that tokens.css keys off.

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme; // 'system'
  }
}
