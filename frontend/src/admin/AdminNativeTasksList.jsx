import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminNativeTasks } from '../api.js';

export default function AdminNativeTasksList() {
  const { competitionSlug } = useParams();
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  function refresh() {
    setLoading(true);
    adminNativeTasks
      .list(competitionSlug)
      .then((r) => {
        setTasks(r.tasks || []);
        setError(null);
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => { refresh(); }, [competitionSlug]);

  async function onCreate() {
    const slug = window.prompt('Slug новой задачи (a-z, 0-9, дефисы):');
    if (!slug) return;
    const title = window.prompt('Title:');
    if (!title) return;
    try {
      await adminNativeTasks.create(competitionSlug, { slug: slug.trim().toLowerCase(), title: title.trim() });
      refresh();
    } catch (e) {
      window.alert(`Не удалось создать: ${e.message || e}`);
    }
  }

  async function onDelete(slug) {
    if (!window.confirm(`Удалить задачу '${slug}'? (soft delete)`)) return;
    try {
      await adminNativeTasks.delete(competitionSlug, slug);
      refresh();
    } catch (e) {
      window.alert(`Не удалось удалить: ${e.message || e}`);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Native задачи: {competitionSlug}</h2>
        <button onClick={onCreate} className="control-btn">+ Создать задачу</button>
      </div>
      {error ? <p className="status error">{error}</p> : null}
      {loading ? (
        <p className="status">Загрузка…</p>
      ) : tasks.length === 0 ? (
        <p className="status">Задач ещё нет — создайте первую.</p>
      ) : (
        <table className="admin-comp-table">
          <thead><tr><th>Slug</th><th>Title</th><th>Файлы</th><th></th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.slug}>
                <td>
                  <Link to={`/admin/competitions/${encodeURIComponent(competitionSlug)}/native-tasks/${encodeURIComponent(t.slug)}`}>
                    {t.slug}
                  </Link>
                </td>
                <td>{t.title}</td>
                <td className="muted">
                  {t.graderPath ? '✓ grader · ' : ''}
                  {t.groundTruthPath ? '✓ ground-truth' : ''}
                </td>
                <td><button onClick={() => onDelete(t.slug)}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
