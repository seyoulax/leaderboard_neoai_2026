import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dict } from './dict.js';

const STORAGE_KEY = 'lang';
const SUPPORTED = ['ru', 'en'];

function detectInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch (_) { /* ignore */ }
  // Browser default → en if not Russian
  if (typeof navigator !== 'undefined' && navigator.language?.startsWith('ru')) return 'ru';
  return 'ru';
}

const Ctx = createContext({ lang: 'ru', setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectInitialLang());

  const setLang = useCallback((next) => {
    if (!SUPPORTED.includes(next)) return;
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) { /* ignore */ }
    if (typeof document !== 'undefined') document.documentElement.lang = next;
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback(
    (key, vars) => {
      const entry = dict[key];
      let str = (entry && entry[lang]) || (entry && entry.ru) || key;
      if (vars && typeof str === 'string') {
        for (const k of Object.keys(vars)) str = str.replaceAll(`{${k}}`, String(vars[k]));
      }
      return str;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

export function useT() {
  return useContext(Ctx).t;
}

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      {SUPPORTED.map((code) => (
        <button
          key={code}
          type="button"
          className={`lang-toggle-btn ${lang === code ? 'active' : ''}`}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
