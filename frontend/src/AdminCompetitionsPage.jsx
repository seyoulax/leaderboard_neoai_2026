import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getAdminCompetitions,
  saveAdminCompetitions,
  createAdminCompetition,
  deleteAdminCompetition,
} from './api';

export default function AdminCompetitionsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ slug: '', title: '', subtitle: '', order: 0, visible: true, type: 'kaggle', visibility: 'public' });

  async function refresh() {
    try {
      setLoading(true);
      const r = await getAdminCompetitions();
      setList(r.competitions || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  function updateAt(idx, field, value) {
    setList((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  async function saveAll() {
    setBusy(true); setError(null);
    try {
      await saveAdminCompetitions(list);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    setBusy(true); setError(null);
    try {
      const payload = {
        slug: draft.slug.trim(),
        title: draft.title.trim(),
        order: Number(draft.order) || 0,
        visible: !!draft.visible,
        type: draft.type === 'native' ? 'native' : 'kaggle',
        visibility: draft.visibility === 'unlisted' ? 'unlisted' : 'public',
      };
      if (draft.subtitle.trim()) payload.subtitle = draft.subtitle.trim();
      await createAdminCompetition(payload);
      setDraft({ slug: '', title: '', subtitle: '', order: 0, visible: true, type: 'kaggle', visibility: 'public' });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug) {
    if (!window.confirm(`Удалить соревнование '${slug}'? Файлы переименуются в .deleted-<ts>.`)) return;
    setBusy(true); setError(null);
    try {
      await deleteAdminCompetition(slug);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="status">Загрузка...</p>;

  return (
    <div className="admin-comp">
      <header className="admin-comp-header">
        <p className="eyebrow">Админка</p>
        <h1>Соревнования</h1>
      </header>

      {error ? <p className="status error">{error}</p> : null}

      <section className="panel native-edit-panel">
        <div className="panel-head">
          <h2>+ Новое соревнование</h2>
          <span>Kaggle = подгрузка ЛБ из Kaggle CLI · Native = задачи + сабмиты у нас</span>
        </div>
        <div className="native-edit-body">
          <div className="admin-create-grid">
            <label className="native-field">
              <span className="native-field-label">slug *</span>
              <input
                className="control-input"
                placeholder="neoai-2026"
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
            </label>
            <label className="native-field">
              <span className="native-field-label">title *</span>
              <input
                className="control-input"
                placeholder="NEOAI 2026"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="native-field" style={{ gridColumn: 'span 2' }}>
              <span className="native-field-label">subtitle (опц.)</span>
              <input
                className="control-input"
                placeholder="Northern Eurasia Olympiad in AI"
                value={draft.subtitle}
                onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              />
            </label>
            <label className="native-field" style={{ maxWidth: 120 }}>
              <span className="native-field-label">order</span>
              <input
                className="control-input"
                type="number"
                value={draft.order}
                onChange={(e) => setDraft({ ...draft, order: e.target.value })}
              />
            </label>
            <label className="native-anchor native-anchor-checkbox" style={{ alignSelf: 'end', paddingBottom: 12 }}>
              <input
                type="checkbox"
                checked={draft.visible}
                onChange={(e) => setDraft({ ...draft, visible: e.target.checked })}
              />
              <span>visible</span>
            </label>
          </div>

          <div className="admin-create-radios">
            <fieldset className="native-anchors">
              <legend>Тип</legend>
              <div className="native-anchors-grid">
                <label className="native-anchor native-anchor-checkbox">
                  <input type="radio" name="type" value="kaggle" checked={draft.type === 'kaggle'} onChange={() => setDraft({ ...draft, type: 'kaggle' })} />
                  <span>Kaggle</span>
                </label>
                <label className="native-anchor native-anchor-checkbox">
                  <input type="radio" name="type" value="native" checked={draft.type === 'native'} onChange={() => setDraft({ ...draft, type: 'native' })} />
                  <span>Native</span>
                </label>
              </div>
            </fieldset>
            <fieldset className="native-anchors">
              <legend>Видимость</legend>
              <div className="native-anchors-grid">
                <label className="native-anchor native-anchor-checkbox">
                  <input type="radio" name="visibility" value="public" checked={draft.visibility === 'public'} onChange={() => setDraft({ ...draft, visibility: 'public' })} />
                  <span>Public — в каталоге</span>
                </label>
                <label className="native-anchor native-anchor-checkbox">
                  <input type="radio" name="visibility" value="unlisted" checked={draft.visibility === 'unlisted'} onChange={() => setDraft({ ...draft, visibility: 'unlisted' })} />
                  <span>Unlisted — только по ссылке</span>
                </label>
              </div>
            </fieldset>
          </div>

          <div className="native-edit-actions">
            <button
              className="control-btn"
              disabled={busy || !draft.slug || !draft.title}
              onClick={createNew}
            >
              {busy ? 'Создаём…' : 'Создать соревнование'}
            </button>
          </div>
        </div>
      </section>

      <section className="panel native-edit-panel">
        <div className="panel-head">
          <h2>Существующие</h2>
          <span>{list.length} {plural(list.length, 'соревнование', 'соревнования', 'соревнований')}</span>
        </div>
        <div className="admin-comp-table-wrap">
          <table className="admin-comp-table v2">
            <thead>
              <tr>
                <th>slug</th>
                <th>title</th>
                <th>subtitle</th>
                <th style={{ width: 80 }}>order</th>
                <th style={{ width: 70 }}>visible</th>
                <th style={{ width: 100 }}>тип</th>
                <th style={{ width: 130 }}>видимость</th>
                <th style={{ width: 200 }}>тема</th>
                <th style={{ width: 140 }}>задачи</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c, idx) => (
                <tr key={c.slug}>
                  <td>
                    <Link to={`/admin/competitions/${encodeURIComponent(c.slug)}/tasks`} className="admin-comp-slug">
                      {c.slug}
                    </Link>
                  </td>
                  <td>
                    <input
                      className="admin-cell-input"
                      value={c.title}
                      onChange={(e) => updateAt(idx, 'title', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="admin-cell-input"
                      value={c.subtitle || ''}
                      onChange={(e) => updateAt(idx, 'subtitle', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="admin-cell-input mono"
                      type="number"
                      value={c.order ?? 0}
                      onChange={(e) => updateAt(idx, 'order', Number(e.target.value))}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={c.visible !== false}
                      onChange={(e) => updateAt(idx, 'visible', e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                  </td>
                  <td>
                    <span className={`competition-badge competition-badge-${c.type || 'kaggle'}`} title="нельзя поменять после создания">
                      {c.type || 'kaggle'}
                    </span>
                  </td>
                  <td>
                    <select
                      className="admin-cell-select"
                      value={c.visibility || 'public'}
                      onChange={(e) => updateAt(idx, 'visibility', e.target.value)}
                    >
                      <option value="public">public</option>
                      <option value="unlisted">unlisted</option>
                    </select>
                  </td>
                  <td>
                    <ThemeEditor
                      value={c.theme}
                      onChange={(theme) => updateAt(idx, 'theme', theme)}
                    />
                  </td>
                  <td>
                    {c.type === 'native' ? (
                      <Link
                        to={`/admin/competitions/${encodeURIComponent(c.slug)}/native-tasks`}
                        className="admin-comp-tasks-link"
                      >
                        native-tasks →
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="control-btn control-btn-ghost"
                      onClick={() => remove(c.slug)}
                      title="удалить"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="native-edit-actions" style={{ padding: '16px 24px', borderTop: '1px solid var(--line)' }}>
          <button disabled={busy} onClick={saveAll} className="control-btn">
            {busy ? 'Сохраняем…' : '💾 Сохранить изменения'}
          </button>
        </div>
      </section>
    </div>
  );
}

const PRESET_LABELS = {
  default: 'default',
  'highlight-rising': 'highlight-rising',
  minimal: 'minimal',
};

function ThemeEditor({ value, onChange }) {
  const accent = value?.accent || '#7d5fff';
  const preset = value?.preset || 'default';

  function set(patch) {
    const next = { accent, preset, ...patch };
    // нормализуем default'ы: если оба дефолтные — храним null
    const isDefaultAccent = next.accent === '#7d5fff';
    const isDefaultPreset = next.preset === 'default';
    onChange(isDefaultAccent && isDefaultPreset ? null : next);
  }

  return (
    <div className="admin-theme-cell">
      <input
        type="color"
        value={accent}
        onChange={(e) => set({ accent: e.target.value.toLowerCase() })}
        title="accent цвет"
        className="admin-theme-color"
      />
      <select
        className="admin-cell-select"
        value={preset}
        onChange={(e) => set({ preset: e.target.value })}
        title="вариант оформления"
      >
        {Object.entries(PRESET_LABELS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    </div>
  );
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
