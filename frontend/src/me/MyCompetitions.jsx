import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { meApi, membership } from '../api.js';

export default function MyCompetitions() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  async function load() {
    try { const r = await meApi.competitions(); setItems(r.competitions); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function leave(slug) {
    if (!confirm(`Выйти из соревнования «${slug}»?`)) return;
    await membership.leave(slug);
    load();
  }

  if (error) return <div className="error">{error}</div>;
  if (items.length === 0) return <p className="dim">Вы ни в одном соревновании</p>;

  return (
    <section>
      <h2>Мои соревнования</h2>
      <table>
        <thead><tr><th>Соревнование</th><th>Тип</th><th>Очки</th><th>Место</th><th>С</th><th></th></tr></thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.slug}>
              <td><Link to={`/competitions/${c.slug}`}>{c.title}</Link></td>
              <td>{c.type}</td>
              <td>{c.totalPoints != null ? c.totalPoints.toFixed(2) : '—'}</td>
              <td>{c.place ?? '—'}</td>
              <td>{new Date(c.joinedAt).toLocaleDateString()}</td>
              <td><button onClick={() => leave(c.slug)}>Выйти</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
