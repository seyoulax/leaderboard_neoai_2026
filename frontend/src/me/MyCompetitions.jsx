import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { meApi, membership } from '../api.js';
import { useT } from '../i18n/I18nContext.jsx';

export default function MyCompetitions() {
  const t = useT();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  async function load() {
    try { const r = await meApi.competitions(); setItems(r.competitions); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function leave(slug) {
    if (!confirm(t('mycomp.confirm.leave', { slug }))) return;
    await membership.leave(slug);
    load();
  }

  if (error) return <div className="error">{error}</div>;
  if (items.length === 0) return <p className="dim">{t('me.empty.competitions')}</p>;

  return (
    <section>
      <h2>{t('me.title.competitions')}</h2>
      <table>
        <thead><tr>
          <th>{t('mycomp.col.competition')}</th>
          <th>{t('mycomp.col.type')}</th>
          <th>{t('mycomp.col.points')}</th>
          <th>{t('mycomp.col.place')}</th>
          <th>{t('mycomp.col.joined')}</th>
          <th></th>
        </tr></thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.slug}>
              <td><Link to={`/competitions/${c.slug}`}>{c.title}</Link></td>
              <td>{c.type}</td>
              <td>{c.totalPoints != null ? c.totalPoints.toFixed(2) : '—'}</td>
              <td>{c.place ?? '—'}</td>
              <td>{new Date(c.joinedAt).toLocaleDateString()}</td>
              <td><button onClick={() => leave(c.slug)}>{t('mycomp.action.leave')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
