import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { competitions as competitionsApi } from './api';
import { useT } from './i18n/I18nContext.jsx';

export default function CompetitionsListPage() {
  const t = useT();
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
        <h2>{t('comps.title')}</h2>
        <input
          type="search"
          value={q}
          onChange={onChange}
          placeholder={t('comps.search_placeholder')}
          className="competitions-search"
        />
      </div>
      {error ? <p className="status error">{error}</p> : null}
      {loading ? (
        <p className="status">{t('comps.loading')}</p>
      ) : items.length === 0 ? (
        <p className="status">
          {q ? t('comps.not_found', { q }) : t('comps.empty')}
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
