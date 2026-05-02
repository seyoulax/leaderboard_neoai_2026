import { useEffect, useState } from 'react';
import { getOverallLeaderboard } from './api';
import './obs.css';

const PAGE_SIZE = 15;
const PAGE_MS = 20_000;
const REFRESH_MS = 30_000;

function usePolling(loader) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const data = await loader();
        if (!active) return;
        setState({ data, loading: false, error: null });
      } catch (error) {
        if (!active) return;
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    run();
    const timer = setInterval(run, REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return state;
}

export default function ObsCycle() {
  useEffect(() => {
    document.documentElement.classList.add('obs');
    return () => document.documentElement.classList.remove('obs');
  }, []);

  const { data, loading, error } = usePolling(() => getOverallLeaderboard());
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setPageIdx((p) => p + 1), PAGE_MS);
    return () => clearInterval(timer);
  }, []);

  const total = data?.overall?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = pageIdx % totalPages;
  const start = currentPage * PAGE_SIZE;
  const slice = (data?.overall || []).slice(start, start + PAGE_SIZE);
  const endShown = Math.min(start + PAGE_SIZE, total);

  return (
    <div className="obs-root">
      <div className="obscycle">
        <div className="obscycle-head">
          <div className="obscycle-brand">NEOAI</div>
          <div className="obscycle-eyebrow">Northern Eurasia Olympiad in Artificial Intelligence 2026</div>
          <div className="obscycle-context">
            {total > 0 ? (
              <>
                <span className="obscycle-context-main">Места {start + 1}–{endShown}</span>
                <span className="obscycle-context-sub">
                  стр. {currentPage + 1} / {totalPages}
                </span>
              </>
            ) : (
              'Загрузка'
            )}
          </div>
        </div>

        {loading ? (
          <div className="obscycle-empty">Загрузка...</div>
        ) : error ? (
          <div className="obscycle-empty">{error}</div>
        ) : total === 0 ? (
          <div className="obscycle-empty">Нет данных</div>
        ) : (
          <div className="obscycle-table-wrap">
            <table className="obscycle-table">
              <thead>
                <tr>
                  <th className="obscycle-th-rank">#</th>
                  <th className="obscycle-th-name">Участник</th>
                  <th className="obscycle-th-total">Total</th>
                  {data.tasks.map((task) => (
                    <th key={task.slug} className="obscycle-th-task">
                      {task.title.replace(/^NEOAI\s*/i, '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((row) => (
                  <tr key={row.participantKey}>
                    <td className="obscycle-td-rank">{row.place}</td>
                    <td className="obscycle-td-name">{row.nickname || row.teamName || '-'}</td>
                    <td className="obscycle-td-total">{row.totalPoints.toFixed(2)}</td>
                    {data.tasks.map((task) => {
                      const points = row.tasks?.[task.slug]?.points;
                      return (
                        <td key={task.slug} className="obscycle-td-task">
                          {points !== undefined ? points.toFixed(1) : '·'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
