import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCompetitions } from './api';

export default function CompetitionsListPage() {
  const [data, setData] = useState({ loading: true, competitions: [], error: null });

  useEffect(() => {
    let active = true;
    getCompetitions()
      .then((r) => { if (active) setData({ loading: false, competitions: r.competitions || [], error: null }); })
      .catch((e) => { if (active) setData({ loading: false, competitions: [], error: e.message }); });
    return () => { active = false; };
  }, []);

  if (data.loading) return <p className="status">Загрузка соревнований...</p>;
  if (data.error) return <p className="status error">{data.error}</p>;
  if (data.competitions.length === 0) {
    return <p className="status">Соревнований пока нет — создайте в админке (/admin).</p>;
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Соревнования</h2></div>
      <div className="competitions-list">
        {data.competitions.map((c) => (
          <Link key={c.slug} to={`/competitions/${encodeURIComponent(c.slug)}/leaderboard`} className="competition-card">
            <div className="competition-title">{c.title}</div>
            {c.subtitle ? <div className="competition-subtitle">{c.subtitle}</div> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
