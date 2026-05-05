import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { meApi } from '../api.js';

export default function MySubmissionsCabinet() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    meApi.submissions({ limit: 100 }).then((r) => setItems(r.submissions)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (items.length === 0) return <p className="dim">Сабмитов пока нет</p>;

  return (
    <section>
      <h2>Мои сабмиты</h2>
      <table className="submissions-table">
        <thead>
          <tr><th>Когда</th><th>Соревнование</th><th>Задача</th><th>Файл</th><th>Статус</th><th>Public</th><th>Private</th><th>Selected</th></tr>
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
