import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getTheme } from '../api';

export const TOKEN_KEYS = ['bg', 'card', 'ink', 'muted', 'line', 'accent'];

// Token → CSS variable name on :root.
const CSS_VAR = {
  bg:     '--bg',
  card:   '--card',
  ink:    '--ink',
  muted:  '--muted',
  line:   '--line',
  accent: '--accent',
};

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const k of TOKEN_KEYS) {
    const val = (theme && theme[k]) || '';
    if (val) root.style.setProperty(CSS_VAR[k], val);
    else root.style.removeProperty(CSS_VAR[k]);
  }
  // Auto-derive --accent-soft / --accent-glow / --line-strong from accent if set.
  const accent = theme?.accent || '';
  if (accent) {
    const soft = hexToRgba(accent, 0.18);
    const glow = hexToRgba(accent, 0.5);
    if (soft) root.style.setProperty('--accent-soft', soft);
    if (glow) root.style.setProperty('--accent-glow', glow);
  } else {
    root.style.removeProperty('--accent-soft');
    root.style.removeProperty('--accent-glow');
  }
  // muted in styles.css uses rgba(255,255,255,0.55) — if user picks a light bg
  // their choice would still be applied as-is (no auto-derivation needed).
}

const Ctx = createContext({ theme: {}, refresh: () => {}, setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState({});

  const refresh = useCallback(async () => {
    try {
      const r = await getTheme();
      setThemeState(r.theme || {});
      applyTheme(r.theme || {});
    } catch (_) { /* keep defaults */ }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Optimistic local update (used by admin save).
  const setTheme = useCallback((next) => {
    setThemeState(next || {});
    applyTheme(next || {});
  }, []);

  const value = useMemo(() => ({ theme, refresh, setTheme }), [theme, refresh, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
