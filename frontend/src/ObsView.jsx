import { useEffect, useRef, useState } from 'react';
import './obs.css';

const TOP_N = 15;
const REFRESH_MS = 30_000;
const HIGHLIGHT_MS = 5000;

function rowClass(rank, entered, dir) {
  let cls = 'obs-row';
  if (rank === 1) cls += ' obs-top1';
  else if (rank === 2) cls += ' obs-top2';
  else if (rank === 3) cls += ' obs-top3';
  if (entered) cls += ' obs-row-new';
  if (dir === 'up') cls += ' row-up';
  else if (dir === 'down') cls += ' row-down';
  return cls;
}

export default function ObsView({ contextLabel, rows, updatedAt, loading, error }) {
  useEffect(() => {
    document.documentElement.classList.add('obs');
    return () => document.documentElement.classList.remove('obs');
  }, []);

  const top = (rows || []).slice(0, TOP_N);

  const prevKeysRef = useRef(new Set());
  const seenFirstRef = useRef(false);
  const [entered, setEntered] = useState(() => new Map());

  useEffect(() => {
    if (top.length === 0) return;

    const prevKeys = prevKeysRef.current;
    const fresh = !seenFirstRef.current;

    if (!fresh) {
      const newcomers = [];
      for (const row of top) {
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

    prevKeysRef.current = new Set(top.map((r) => r.key));
    seenFirstRef.current = true;
  }, [rows]);

  return (
    <div className="obs-root">
      <div className="obs-overlay">
        <div className="obs-panel">
          <div className="obs-head">
            <div className="obs-brand">NEOAI</div>
            <div className="obs-eyebrow">Northern Eurasia Olympiad in Artificial Intelligence 2026</div>
            {contextLabel ? <div className="obs-context">{contextLabel}</div> : null}
          </div>

          <div className="obs-table-header">
            <span className="obs-col-rank">#</span>
            <span className="obs-col-name">Участник</span>
            <span className="obs-col-score">Баллы</span>
          </div>

          {loading ? (
            <div className="obs-empty">Загрузка...</div>
          ) : error ? (
            <div className="obs-empty">{error}</div>
          ) : top.length === 0 ? (
            <div className="obs-empty">Нет данных</div>
          ) : (
            <div className="obs-rows">
              {top.map((row, i) => {
                const rank = i + 1;
                const isNew = entered.has(row.key);
                return (
                  <div key={row.key} className={rowClass(rank, isNew, row.dir)}>
                    <div className="obs-rank">
                      <span className="obs-rank-num">{rank}</span>
                      {row.placeDelta ? (
                        <span className={`place-delta ${row.placeDelta > 0 ? 'up' : 'down'}`}>
                          {' '}{row.placeDelta > 0 ? '▲' : '▼'}{Math.abs(row.placeDelta)}
                        </span>
                      ) : null}
                    </div>
                    <div className="obs-name">{row.name}</div>
                    <div className="obs-score">
                      {row.score}
                      {row.dir === 'up' ? <span className="delta-arrow up"> ▲</span> : null}
                      {row.dir === 'down' ? <span className="delta-arrow down"> ▼</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="obs-status">
            <span><span className="obs-live-dot" />Авто-обновление каждые {REFRESH_MS / 1000}с</span>
            <span>
              {updatedAt
                ? 'Обновлено: ' +
                  new Date(updatedAt).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
