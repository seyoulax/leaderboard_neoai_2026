import { useEffect, useRef, useState } from 'react';
import './obs.css';

const PAGE_SIZE = 10;
const PAGE_MS = 15_000;
const REFRESH_MS = 30_000;
const HIGHLIGHT_MS = 5000;

function cellClass(rank, page, entered) {
  let cls = 'obsbar-cell';
  if (page === 0) {
    if (rank === 1) cls += ' obsbar-top1';
    else if (rank === 2) cls += ' obsbar-top2';
    else if (rank === 3) cls += ' obsbar-top3';
  }
  if (entered) cls += ' obsbar-cell-new';
  return cls;
}

export default function ObsBar({ contextLabel, rows, updatedAt, loading, error }) {
  useEffect(() => {
    document.documentElement.classList.add('obs');
    return () => document.documentElement.classList.remove('obs');
  }, []);

  const allRows = rows || [];
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    if (totalPages <= 1) return;
    const timer = setInterval(() => setPageIdx((p) => p + 1), PAGE_MS);
    return () => clearInterval(timer);
  }, [totalPages]);

  const currentPage = pageIdx % totalPages;
  const start = currentPage * PAGE_SIZE;
  const visible = allRows.slice(start, start + PAGE_SIZE);

  const prevKeysRef = useRef(new Set());
  const seenFirstRef = useRef(false);
  const [entered, setEntered] = useState(() => new Map());

  useEffect(() => {
    if (allRows.length === 0) return;

    const prevKeys = prevKeysRef.current;
    const fresh = !seenFirstRef.current;

    if (!fresh) {
      const newcomers = [];
      for (const row of allRows) {
        if (!prevKeys.has(row.key)) {
          newcomers.push({ key: row.key, stamp: Date.now() + Math.random() });
        }
      }

      if (newcomers.length > 0) {
        setEntered((current) => {
          const next = new Map(current);
          for (const n of newcomers) next.set(n.key, n.stamp);
          return next;
        });

        const stamps = new Map(newcomers.map((n) => [n.key, n.stamp]));
        setTimeout(() => {
          setEntered((current) => {
            const next = new Map(current);
            for (const [k, s] of stamps) {
              if (next.get(k) === s) next.delete(k);
            }
            return next;
          });
        }, HIGHLIGHT_MS);
      }
    }

    prevKeysRef.current = new Set(allRows.map((r) => r.key));
    seenFirstRef.current = true;
  }, [rows]);

  return (
    <div className="obs-root">
      <div className="obs-overlay">
        <div className="obsbar">
          <div className="obsbar-label">
            <div className="obsbar-label-eyebrow">NEOAI</div>
            <div className="obsbar-label-main">{contextLabel || ''}</div>
            <div className="obsbar-label-sub">
              {allRows.length > 0
                ? `Места ${start + 1}–${Math.min(start + PAGE_SIZE, allRows.length)}`
                : 'Суммарный балл'}
            </div>
          </div>

          <div className="obsbar-cells">
            {loading ? (
              <div className="obsbar-empty">Загрузка...</div>
            ) : error ? (
              <div className="obsbar-empty">{error}</div>
            ) : visible.length === 0 ? (
              <div className="obsbar-empty">Нет данных</div>
            ) : (
              visible.map((row, i) => {
                const displayRank = start + i + 1;
                const isNew = entered.has(row.key);
                return (
                  <div key={row.key} className={cellClass(displayRank, currentPage, isNew)}>
                    <div className="obsbar-cell-top">
                      <div className="obsbar-rank">
                        <span className="obsbar-rank-num">{displayRank}</span>
                      </div>
                      <div className="obsbar-name">{row.name}</div>
                      <div className={`obsbar-score ${row.dir === 'up' ? 'cell-up' : row.dir === 'down' ? 'cell-down' : ''}`.trim()}>
                        {row.score}
                        {row.dir === 'up' ? <span className="delta-arrow up"> ▲</span> : null}
                        {row.dir === 'down' ? <span className="delta-arrow down"> ▼</span> : null}
                      </div>
                    </div>
                    {row.taskPoints && row.taskPoints.length > 0 ? (
                      <div className="obsbar-tasks">
                        {row.taskPoints.map((tp) => (
                          <span
                            key={tp.slug}
                            className={`obsbar-task-chip ${tp.dir === 'up' ? 'cell-up' : tp.dir === 'down' ? 'cell-down' : ''}`.trim()}
                          >
                            <span className="obsbar-task-label">{tp.short}</span>
                            <span className="obsbar-task-val">
                              {tp.points !== undefined ? tp.points.toFixed(0) : '·'}
                            </span>
                            {tp.dir === 'up' ? <span className="delta-arrow up">▲</span> : null}
                            {tp.dir === 'down' ? <span className="delta-arrow down">▼</span> : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
