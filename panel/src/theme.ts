export type Theme = 'light' | 'dark';
const KEY = 'viewer.theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' ? 'dark' : 'light'; // claro por defecto
  } catch {
    return 'light';
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
}

export function setTheme(t: Theme): void {
  try { localStorage.setItem(KEY, t); } catch { /* modo privado, etc. */ }
  applyTheme(t);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
