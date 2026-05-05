import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getOverallLeaderboard, getBoards, getCycleConfig } from './api';
import './obs.css';

const PAGE_SIZE = 15;
const PAGE_MS = 20_000;
const REFRESH_MS = 30_000;
const CYCLE_POLL_MS = 5_000;

function usePolling(loader, intervalMs, deps = []) {
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
    const timer = setInterval(run, intervalMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, deps);

  return state;
}

export default function ObsCycle() {
  const { competitionSlug } = useParams();

  useEffect(() => {
    document.documentElement.classList.add('obs');
    return () => document.documentElement.classList.remove('obs');
  }, []);

  const { data, loading, error } = usePolling(
    () => getOverallLeaderboard(competitionSlug),
    REFRESH_MS,
    [competitionSlug]
  );
  const boardsState = usePolling(
    () => getBoards(competitionSlug),
    REFRESH_MS,
    [competitionSlug]
  );
  const cycleState = usePolling(
    () => getCycleConfig(competitionSlug),
    CYCLE_POLL_MS,
    [competitionSlug]
  );

  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setPageIdx((p) => p + 1), PAGE_MS);
    return () => clearInterval(timer);
  }, []);

  const cycleBoardSlug = cycleState.data?.cycleBoardSlug || null;
  const board = cycleBoardSlug
    ? (boardsState.data?.boards || []).find((b) => b.slug === cycleBoardSlug) || null
    : null;

  const allTasks = data?.tasks || [];
  const presentSlugs = board ? board.taskSlugs.filter((s) => allTasks.some((t) => t.slug === s)) : null;
  const visibleTasks = presentSlugs ? allTasks.filter((t) => presentSlugs.includes(t.slug)) : allTasks;

  const oursOverall = data?.oursOverall || [];
  let overall;
  if (board) {
    const enriched = oursOverall
      .map((r) => {
        const total = presentSlugs.reduce((sum, slug) => sum + (r.tasks?.[slug]?.points ?? 0), 0);
        const hasAnyPrev = presentSlugs.some((slug) => r.tasks?.[slug]?.previousPoints != null);
        const prevTotal = hasAnyPrev
          ? presentSlugs.reduce((sum, slug) => sum + (r.tasks?.[slug]?.previousPoints ?? r.tasks?.[slug]?.points ?? 0), 0)
          : null;
        return { ...r, displayTotal: total, previousDisplayTotal: prevTotal };
      })
      .filter((r) => presentSlugs.some((slug) => r.tasks?.[slug] !== undefined));
    const prevPlaceMap = new Map();
    enriched
      .filter((r) => r.previousDisplayTotal != null)
      .slice()
      .sort((a, b) => b.previousDisplayTotal - a.previousDisplayTotal)
      .forEach((r, i) => prevPlaceMap.set(r.participantKey, i + 1));
    overall = enriched
      .sort(
        (a, b) =>
          b.displayTotal - a.displayTotal ||
          (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
      )
      .map((r, i) => ({ ...r, place: i + 1, previousPlace: prevPlaceMap.get(r.participantKey) ?? null }));
  } else {
    overall = oursOverall.map((r) => ({ ...r, displayTotal: r.totalPoints }));
  }

  const total = overall.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = pageIdx % totalPages;
  const start = currentPage * PAGE_SIZE;
  const slice = overall.slice(start, start + PAGE_SIZE);
  const endShown = Math.min(start + PAGE_SIZE, total);

  const eyebrow = board ? board.title : 'Northern Eurasia Olympiad in Artificial Intelligence 2026';

  return (
    <div className="obs-root">
      <div className="obscycle">
        <div className="obscycle-head">
          <div className="obscycle-brand">NEOAI</div>
          <div className="obscycle-eyebrow">{eyebrow}</div>
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
                  {visibleTasks.map((task) => (
                    <th key={task.slug} className="obscycle-th-task">
                      {task.title.replace(/^NEOAI\s*/i, '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((row) => {
                  const dPl = (Number.isFinite(row.previousPlace) && Number.isFinite(row.place))
                    ? row.previousPlace - row.place : 0;
                  return (
                    <tr key={row.participantKey}>
                      <td className="obscycle-td-rank">
                        {row.place}
                        {dPl ? <span className={`place-delta ${dPl > 0 ? 'up' : 'down'}`}> {dPl > 0 ? '▲' : '▼'}{Math.abs(dPl)}</span> : null}
                      </td>
                      <td className="obscycle-td-name">{row.nickname || row.teamName || '-'}</td>
                    <td className="obscycle-td-total">{row.displayTotal.toFixed(2)}</td>
                    {visibleTasks.map((task) => {
                      const points = row.tasks?.[task.slug]?.points;
                      return (
                        <td key={task.slug} className="obscycle-td-task">
                          {points !== undefined ? points.toFixed(1) : '·'}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
