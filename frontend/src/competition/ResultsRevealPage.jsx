import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useResultsStream } from './useResultsStream.js';

export default function ResultsRevealPage() {
  const { competitionSlug } = useParams();
  const { state, error } = useResultsStream(competitionSlug);

  if (error && !state) {
    return <div className="results-reveal status">Подключаемся…</div>;
  }
  if (!state) {
    return <div className="results-reveal status">Загрузка…</div>;
  }
  if (state.phase === 'idle' || state.phase === 'uploaded') {
    return (
      <div className="results-reveal results-reveal-empty">
        <h2>Скоро…</h2>
        <p className="status">Результаты будут раскрыты во время церемонии.</p>
      </div>
    );
  }
  if (state.phase === 'finished') {
    return <FinalTable state={state} />;
  }
  return <RevealingView state={state} />;
}

function RevealingView({ state }) {
  const { revealedRows, skippedRows, drumRoll, currentTop8 } = state;
  // Order outsiders in the ledger newest-on-top (largest rank first → already that way from server).
  return (
    <div className="results-reveal">
      {drumRoll ? <DrumRollOverlay /> : null}
      {currentTop8 ? <Top8Card row={currentTop8} totalRanks={state.totalRanks} /> : null}
      <Ledger
        revealedRows={revealedRows || []}
        skippedRows={skippedRows}
      />
    </div>
  );
}

function DrumRollOverlay() {
  return (
    <div className="results-reveal-drumroll">
      <div className="results-reveal-drumroll-inner">
        <div className="results-reveal-drumroll-emoji">🥁🤔</div>
        <h2>Кто же пройдёт в сборную?</h2>
      </div>
    </div>
  );
}

function Top8Card({ row }) {
  const { rank, fullName, points, bonus, publicPlaceInGroup, dPlace, nameAnimating } = row;
  const animatedName = useTypewriter(fullName, nameAnimating ? 120 : 0);
  return (
    <div className="results-reveal-top8card">
      <div className="results-reveal-top8card-rank">№{rank}</div>
      <div className="results-reveal-top8card-meta">
        {publicPlaceInGroup != null ? (
          <DeltaPill publicPlace={publicPlaceInGroup} delta={dPlace} />
        ) : null}
        {typeof bonus === 'number' ? (
          <div className="results-reveal-top8card-bonus">+{bonus} бонус</div>
        ) : null}
        {typeof points === 'number' ? (
          <div className="results-reveal-top8card-points">{formatPoints(points)} баллов</div>
        ) : null}
      </div>
      <div className="results-reveal-top8card-name">
        {animatedName ? <span>{animatedName}<Caret blink={nameAnimating}/></span> : <span className="results-reveal-placeholder">— — —</span>}
      </div>
    </div>
  );
}

function Caret({ blink }) {
  if (!blink) return null;
  return <span className="results-reveal-caret">▎</span>;
}

function DeltaPill({ publicPlace, delta }) {
  let label = '';
  let cls = 'results-reveal-delta-flat';
  if (delta == null) {
    return null;
  }
  if (delta > 0) { label = `↑ ${delta} мест`; cls = 'results-reveal-delta-up'; }
  else if (delta < 0) { label = `↓ ${Math.abs(delta)} мест`; cls = 'results-reveal-delta-down'; }
  else { label = '= место'; }
  return (
    <div className={`results-reveal-delta ${cls}`}>
      <div className="results-reveal-delta-label">{label}</div>
      <div className="results-reveal-delta-prev">было №{publicPlace}</div>
    </div>
  );
}

function Ledger({ revealedRows, skippedRows }) {
  if (!revealedRows.length && !skippedRows) return null;
  return (
    <div className="results-reveal-ledger">
      {revealedRows.map((row) => (
        <LedgerRow key={`r-${row.rank}`} row={row} />
      ))}
      {skippedRows && skippedRows.length > 0 ? (
        <div className="results-reveal-skipped">
          <div className="results-reveal-skipped-header">…и ещё:</div>
          <div className="results-reveal-skipped-grid">
            {skippedRows.map((row) => (
              <LedgerRow key={`s-${row.rank}`} row={row} compact />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LedgerRow({ row, compact }) {
  return (
    <div className={`results-reveal-row ${compact ? 'compact' : ''}`}>
      <div className="results-reveal-row-rank">№{row.rank}</div>
      <div className="results-reveal-row-name">{row.fullName}</div>
      <div className="results-reveal-row-points">{formatPoints(row.points)}</div>
      {row.bonus ? <div className="results-reveal-row-bonus">+{row.bonus}</div> : null}
      {row.publicPlaceInGroup != null && row.dPlace != null ? (
        <div className="results-reveal-row-delta">
          {row.dPlace > 0 ? `↑${row.dPlace}` : row.dPlace < 0 ? `↓${Math.abs(row.dPlace)}` : '='}
          <span className="results-reveal-row-delta-prev"> (было №{row.publicPlaceInGroup})</span>
        </div>
      ) : null}
    </div>
  );
}

function FinalTable({ state }) {
  const rows = state.finalRows || [];
  return (
    <div className="results-reveal results-reveal-final">
      <h2 className="results-reveal-final-title">🎉 Финальный лидерборд</h2>
      <Confetti />
      <table className="results-reveal-final-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Имя</th>
            <th>Баллы</th>
            <th>Бонус</th>
            <th>Δ public</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rank}>
              <td>{row.rank}</td>
              <td>{row.fullName}</td>
              <td>{formatPoints(row.points)}</td>
              <td>{row.bonus ? `+${row.bonus}` : '—'}</td>
              <td>
                {row.publicPlaceInGroup != null && row.dPlace != null
                  ? (row.dPlace > 0 ? `↑${row.dPlace}` : row.dPlace < 0 ? `↓${Math.abs(row.dPlace)}` : '=')
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Confetti() {
  // Pure-CSS confetti: 60 spans with random x and delay.
  const pieces = useMemo(
    () => Array.from({ length: 60 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 4,
      hue: Math.floor(Math.random() * 360),
      key: i,
    })),
    [],
  );
  return (
    <div className="results-reveal-confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.key}
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            background: `hsl(${p.hue} 80% 60%)`,
          }}
        />
      ))}
    </div>
  );
}

function useTypewriter(target, intervalMs) {
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!target) { setShown(''); return; }
    if (intervalMs === 0) { setShown(target); return; }
    setShown('');
    let i = 0;
    const tid = setInterval(() => {
      i++;
      setShown(target.slice(0, i));
      if (i >= target.length) clearInterval(tid);
    }, intervalMs);
    return () => clearInterval(tid);
  }, [target, intervalMs]);
  return shown;
}

function formatPoints(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  // Strip trailing .0 / .00, keep up to 2 decimals.
  return Math.round(n * 100) / 100 + '';
}
