import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { competitions as competitionsApi } from './api';

export default function CompetitionsListPage() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  function refetch(query) {
    setLoading(true);
    competitionsApi
      .list(query)
      .then((r) => {
        setItems(r.competitions || []);
        setError(null);
      })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refetch('');
    return () => clearTimeout(debounceRef.current);
  }, []);

  function onChange(e) {
    const v = e.target.value;
    setQ(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => refetch(v), 300);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Соревнования</h2>
        <input
          type="search"
          value={q}
          onChange={onChange}
          placeholder="Поиск по названию"
          className="competitions-search"
        />
      </div>
      {error ? <p className="status error">{error}</p> : null}
      {loading ? (
        <p className="status">Загрузка соревнований...</p>
      ) : items.length === 0 ? (
        <p className="status">
          {q ? `Ничего не найдено по «${q}»` : 'Соревнований пока нет — создайте в админке (/admin).'}
        </p>
      ) : (
        <div className="competitions-list">
          {items.map((c) => (
            <Link
              key={c.slug}
              to={`/competitions/${encodeURIComponent(c.slug)}/leaderboard`}
              className="competition-card"
            >
              <div className="competition-title">
                {c.title}
                {c.type === 'native' ? <span className="competition-badge">native</span> : null}
              </div>
              {c.subtitle ? <div className="competition-subtitle">{c.subtitle}</div> : null}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
