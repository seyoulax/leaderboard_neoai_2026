import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminAuthError, getTheme, setAdminTheme } from './api';
import { TOKEN_KEYS, useTheme } from './theme/ThemeProvider.jsx';

const LABELS = {
  bg:     'Фон',
  card:   'Карточки / панели',
  ink:    'Основной текст',
  muted:  'Вторичный текст',
  line:   'Бордеры / разделители',
  accent: 'Акцентный (бренд) цвет',
};

const DEFAULTS = {
  bg:     '#0e0e0e',
  card:   '#161616',
  ink:    '#ffffff',
  muted:  '#8c8c8c',
  line:   '#262626',
  accent: '#7d5fff',
};

function ColorRow({ token, value, onChange }) {
  // value is '' (use built-in default) or '#rrggbb'
  const effective = value || DEFAULTS[token];
  return (
    <div className="theme-row">
      <div className="theme-row-label">
        <span>{LABELS[token]}</span>
        <code className="muted" style={{ fontSize: 11 }}>--{token}</code>
      </div>
      <div className="theme-row-controls">
        <input
          type="color"
          value={effective}
          onChange={(e) => onChange(e.target.value)}
          className="theme-color-input"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`(default: ${DEFAULTS[token]})`}
          className="control-input theme-hex-input"
        />
        {value ? (
          <button type="button" className="control-btn control-btn-ghost" onClick={() => onChange('')}>
            сбросить
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminThemePage() {
  const navigate = useNavigate();
  const { setTheme: applyLocally, refresh } = useTheme();
  const [theme, setForm] = useState(() => Object.fromEntries(TOKEN_KEYS.map((k) => [k, ''])));
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await getTheme();
      const next = Object.fromEntries(TOKEN_KEYS.map((k) => [k, r.theme?.[k] || '']));
      setForm(next);
      setOriginal(JSON.stringify(next));
    } catch (e) {
      if (e instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function update(token, value) {
    const next = { ...theme, [token]: value };
    setForm(next);
    applyLocally(next); // live preview без сохранения
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await setAdminTheme(theme);
      const saved = Object.fromEntries(TOKEN_KEYS.map((k) => [k, r.theme?.[k] || '']));
      setForm(saved);
      setOriginal(JSON.stringify(saved));
      applyLocally(saved);
      setSavedAt(new Date());
    } catch (e) {
      if (e instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function resetAll() {
    if (!confirm('Сбросить все цвета на дефолтные?')) return;
    const empty = Object.fromEntries(TOKEN_KEYS.map((k) => [k, '']));
    setForm(empty);
    applyLocally(empty);
  }

  const dirty = JSON.stringify(theme) !== original;

  if (loading) return <p className="status">Загрузка темы…</p>;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Тема (глобально)</h2>
        <span>
          {dirty ? 'есть несохранённые изменения' : savedAt ? `сохранено ${savedAt.toLocaleTimeString()}` : 'без изменений'}
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="theme-body">
        <p className="meta" style={{ borderBottom: 0, padding: '0 0 12px' }}>
          Цвета применяются на всём сайте. Изменения видны сразу в превью; нажми «Сохранить» чтобы зафиксировать. Пустое значение = дефолт из встроенной темы.
        </p>

        {TOKEN_KEYS.map((token) => (
          <ColorRow
            key={token}
            token={token}
            value={theme[token]}
            onChange={(v) => update(token, v)}
          />
        ))}

        <div className="theme-actions">
          <button className="control-btn control-btn-ghost" onClick={resetAll}>Сбросить всё</button>
          <button className="control-btn control-btn-ghost" onClick={() => { setForm(JSON.parse(original)); applyLocally(JSON.parse(original)); }} disabled={!dirty || saving}>
            Откатить изменения
          </button>
          <button className="control-btn" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </section>
  );
}
