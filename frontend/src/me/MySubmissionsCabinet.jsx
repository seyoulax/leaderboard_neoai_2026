import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { meApi } from '../api.js';
import { useT } from '../i18n/I18nContext.jsx';

export default function MySubmissionsCabinet() {
  const t = useT();
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    meApi.submissions({ limit: 100 }).then((r) => setItems(r.submissions)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (items.length === 0) return <p className="dim">{t('me.empty.submissions')}</p>;

  return (
    <section>
      <h2>{t('me.title.submissions')}</h2>
      <table className="submissions-table">
        <thead>
          <tr>
            <th>{t('mysub.col.when')}</th>
            <th>{t('mysub.col.competition')}</th>
            <th>{t('mysub.col.task')}</th>
            <th>{t('mysub.col.file')}</th>
            <th>{t('mysub.col.status')}</th>
            <th>{t('mysub.col.public')}</th>
            <th>{t('mysub.col.private')}</th>
            <th>{t('mysub.col.selected')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.createdAt).toLocaleString()}</td>
              <td><Link to={`/competitions/${s.competitionSlug}`}>{s.competitionSlug}</Link></td>
              <td><Link to={`/competitions/${s.competitionSlug}/native-tasks/${s.taskSlug}`}>{s.taskSlug}</Link></td>
              <td>{s.originalFilename}</td>
              <td>{s.status}</td>
              <td>{s.pointsPublic != null ? s.pointsPublic.toFixed(2) : '—'}</td>
              <td>{s.pointsPrivate != null ? s.pointsPrivate.toFixed(2) : '—'}</td>
              <td>{s.selected ? '★' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
