import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { results, getOverallLeaderboard, getBoards } from '../api.js';

export default function AdminResultsPage() {
  const { slug: competitionSlug } = useParams();
  const [state, setState] = useState(null);
  const [groupsMeta, setGroupsMeta] = useState([]);
  const [boards, setBoards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!competitionSlug) return;
    let active = true;
    Promise.all([
      results.adminGet(competitionSlug),
      getOverallLeaderboard(competitionSlug).catch(() => null),
      getBoards(competitionSlug).catch(() => null),
    ]).then(([s, lb, bd]) => {
      if (!active) return;
      setState(s);
      setGroupsMeta(lb?.groupsMeta || []);
      setBoards(bd?.boards || []);
    }).catch((e) => {
      if (active) setErr(e.message || String(e));
    });
    return () => { active = false; };
  }, [competitionSlug]);

  async function refetch() {
    const s = await results.adminGet(competitionSlug);
    setState(s);
  }

  async function withBusy(fn) {
    setBusy(true); setErr(null);
    try { await fn(); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  function onUploadFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    withBusy(async () => {
      const text = await file.text();
      const next = await results.upload(competitionSlug, text);
      setState(next);
    });
  }

  function onSetGroup(slug) {
    withBusy(async () => {
      const next = await results.setSettings(competitionSlug, { compareGroupSlug: slug });
      setState(next);
    });
  }

  function onSetSource(source) {
    withBusy(async () => {
      const next = await results.setSettings(competitionSlug, { compareSource: source });
      setState(next);
    });
  }

  function onStart() {
    withBusy(async () => {
      const next = await results.start(competitionSlug);
      setState(next);
    });
  }

  function onAdvance() {
    withBusy(async () => {
      const next = await results.advance(competitionSlug, state?.stepId);
      setState(next);
    });
  }

  function onReset() {
    if (!confirm('Сбросить церемонию полностью? CSV и состояние будут удалены.')) return;
    withBusy(async () => {
      await results.reset(competitionSlug);
      await refetch();
    });
  }

  if (!state) return <div className="status">Загрузка…</div>;

  return (
    <div className="admin-results">
      <h2>Церемония результатов</h2>
      {err ? <p className="status error">{err}</p> : null}

      <UploadSection state={state} onUpload={onUploadFile} disabled={busy} />
      <SettingsSection
        state={state}
        groupsMeta={groupsMeta}
        boards={boards}
        onChangeGroup={onSetGroup}
        onChangeSource={onSetSource}
        disabled={busy}
      />
      <StartSection state={state} onStart={onStart} disabled={busy} />
      {state.phase === 'revealing' || state.phase === 'finished' ? (
        <RevealSection state={state} onAdvance={onAdvance} disabled={busy} />
      ) : null}
      <ResetSection onReset={onReset} disabled={busy} />
    </div>
  );
}

function UploadSection({ state, onUpload, disabled }) {
  const blocked = state.phase === 'revealing' || state.phase === 'finished';
  return (
    <section className="admin-results-section">
      <h3>1. Загрузить финальный CSV</h3>
      <p className="status">Колонки: <code>kaggleId, fullName, points, bonus</code>. Сортируется автоматически по убыванию.</p>
      <input type="file" accept=".csv,text/csv" onChange={onUpload} disabled={disabled || blocked} />
      {blocked ? <p className="status">Сначала «Сбросить церемонию», чтобы перезагрузить CSV.</p> : null}
      {state.rows?.length ? (
        <details>
          <summary>Превью ({state.rows.length} строк)</summary>
          <table className="admin-results-preview-table">
            <thead><tr><th>№</th><th>kaggleId</th><th>ФИО</th><th>Баллы</th><th>Бонус</th></tr></thead>
            <tbody>
              {state.rows.slice(0, 50).map((r) => (
                <tr key={r.rank}><td>{r.rank}</td><td>{r.kaggleId}</td><td>{r.fullName}</td><td>{r.points}</td><td>{r.bonus}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}

function SettingsSection({ state, groupsMeta, boards, onChangeGroup, onChangeSource, disabled }) {
  const blocked = state.phase === 'revealing' || state.phase === 'finished';
  const groupValue = state.compareGroupSlug || '';
  const sourceValue = state.compareSource || 'overall';
  const lockedSelect = disabled || blocked || state.phase === 'idle';
  return (
    <section className="admin-results-section">
      <h3>2. С чем сравниваем</h3>
      <p className="status">«Было место №X» считается внутри выбранной группы по выбранному public-лидерборду.</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Группа</span>
          <select
            value={groupValue}
            onChange={(e) => onChangeGroup(e.target.value)}
            disabled={lockedSelect}
          >
            <option value="" disabled>— выберите —</option>
            {(groupsMeta || []).map((g) => (
              <option key={g.slug} value={g.slug}>{g.title}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Лидерборд</span>
          <select
            value={sourceValue}
            onChange={(e) => onChangeSource(e.target.value)}
            disabled={lockedSelect}
          >
            <option value="overall">Общий public</option>
            {(boards || []).map((b) => (
              <option key={b.slug} value={`board:${b.slug}`}>{b.title}</option>
            ))}
          </select>
        </label>
      </div>
      {state.phase === 'idle' ? <p className="status">Сначала загрузи CSV.</p> : null}
    </section>
  );
}

function StartSection({ state, onStart, disabled }) {
  const ready = state.phase === 'uploaded' && state.compareGroupSlug;
  if (state.phase === 'revealing' || state.phase === 'finished') return null;
  return (
    <section className="admin-results-section">
      <h3>3. Запустить церемонию</h3>
      <button
        type="button"
        className="admin-results-bigbtn"
        onClick={onStart}
        disabled={disabled || !ready}
      >
        Начать церемонию
      </button>
    </section>
  );
}

function RevealSection({ state, onAdvance, disabled }) {
  const cursor = state.cursor || {};
  const stage = cursor.stage;
  return (
    <section className="admin-results-section">
      <h3>{state.phase === 'finished' ? 'Финиш ✨' : 'Раскрытие'}</h3>
      <div className="admin-results-cursor">
        стадия: <b>{stage}</b>{' '}
        {stage === 'outsiders' ? `(показано ${cursor.outsidersIdx + 1}/${state.skipPlan?.outsiders?.length})` : null}
        {stage === 'top8' ? `· топ-${cursor.top8Rank} · ${cursor.top8Step}` : null}
      </div>
      <p className="status">stepId={state.stepId}</p>
      <button
        type="button"
        className="admin-results-bigbtn"
        onClick={onAdvance}
        disabled={disabled || state.phase !== 'revealing'}
      >
        Следующий шаг ▶
      </button>
    </section>
  );
}

function ResetSection({ onReset, disabled }) {
  return (
    <section className="admin-results-section">
      <h3>Сброс</h3>
      <button type="button" onClick={onReset} disabled={disabled}>Сбросить церемонию</button>
    </section>
  );
}
