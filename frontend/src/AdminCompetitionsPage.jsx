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
  const [draft, setDraft] = useState({ slug: '', title: '', subtitle: '', order: 0, visible: true });

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
      };
      if (draft.subtitle.trim()) payload.subtitle = draft.subtitle.trim();
      await createAdminCompetition(payload);
      setDraft({ slug: '', title: '', subtitle: '', order: 0, visible: true });
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
    <section className="panel">
      <div className="panel-head"><h2>Соревнования</h2></div>
      {error ? <p className="status error">{error}</p> : null}

      <div className="admin-comp-create">
        <h3>+ Новое соревнование</h3>
        <div className="admin-comp-row">
          <input placeholder="slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
          <input placeholder="title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="subtitle (опц.)" value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
          <input type="number" placeholder="order" value={draft.order} onChange={(e) => setDraft({ ...draft, order: e.target.value })} />
          <label><input type="checkbox" checked={draft.visible} onChange={(e) => setDraft({ ...draft, visible: e.target.checked })} /> visible</label>
          <button disabled={busy || !draft.slug || !draft.title} onClick={createNew}>Создать</button>
        </div>
      </div>

      <table className="admin-comp-table">
        <thead><tr><th>slug</th><th>title</th><th>subtitle</th><th>order</th><th>visible</th><th></th></tr></thead>
        <tbody>
          {list.map((c, idx) => (
            <tr key={c.slug}>
              <td><Link to={`/admin/competitions/${encodeURIComponent(c.slug)}/tasks`}>{c.slug}</Link></td>
              <td><input value={c.title} onChange={(e) => updateAt(idx, 'title', e.target.value)} /></td>
              <td><input value={c.subtitle || ''} onChange={(e) => updateAt(idx, 'subtitle', e.target.value)} /></td>
              <td><input type="number" value={c.order ?? 0} onChange={(e) => updateAt(idx, 'order', Number(e.target.value))} /></td>
              <td><input type="checkbox" checked={c.visible !== false} onChange={(e) => updateAt(idx, 'visible', e.target.checked)} /></td>
              <td><button onClick={() => remove(c.slug)}>🗑</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <button disabled={busy} onClick={saveAll} className="control-btn" style={{ margin: 16 }}>
        💾 Сохранить все
      </button>
    </section>
  );
}
