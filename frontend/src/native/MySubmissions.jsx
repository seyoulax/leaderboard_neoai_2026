import { useEffect, useRef, useState } from 'react';
import { submissions } from '../api.js';

const POLL_MS = 2000;

function fmtPoints(p) {
  if (p == null) return '—';
  return Number(p).toFixed(2);
}

function StatusBadge({ status }) {
  const cls = `status-badge status-${status}`;
  const label = { pending: 'В очереди', scoring: 'Считается…', scored: 'Готово', failed: 'Ошибка' }[status] || status;
  return <span className={cls}>{label}</span>;
}

export default function MySubmissions({ competitionSlug, taskSlug, refreshKey }) {
  const [list, setList] = useState([]);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  async function refetch() {
    try {
      const { submissions: rows } = await submissions.listMine(competitionSlug, taskSlug);
      setList(rows);
      const active = rows.some((s) => s.status === 'pending' || s.status === 'scoring');
      if (active && !timerRef.current) {
        timerRef.current = setInterval(() => refetch(), POLL_MS);
      } else if (!active && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refetch();
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [competitionSlug, taskSlug, refreshKey]);

  if (error) return <p className="status error">{error}</p>;
  if (list.length === 0) return <p className="muted">Сабмитов пока нет</p>;

  return (
    <table className="submissions-table">
      <thead>
        <tr>
          <th>Когда</th>
          <th>Файл</th>
          <th>Статус</th>
          <th>Public</th>
          <th>Private</th>
          <th>Raw</th>
        </tr>
      </thead>
      <tbody>
        {list.map((s) => (
          <tr key={s.id}>
            <td className="muted" style={{ fontSize: 12 }}>{new Date(s.createdAt).toLocaleString()}</td>
            <td className="mono">{s.originalFilename}</td>
            <td>
              <StatusBadge status={s.status} />
              {s.status === 'failed' && s.errorMessage && (
                <div className="error-text" title={s.logExcerpt || ''}>{s.errorMessage}</div>
              )}
            </td>
            <td className="mono">{fmtPoints(s.pointsPublic)}</td>
            <td className="mono">{fmtPoints(s.pointsPrivate)}</td>
            <td className="muted mono">{s.rawScorePublic ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
