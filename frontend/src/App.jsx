import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  getOverallLeaderboard,
  getTaskLeaderboard,
  getTasks,
  getBoards,
  getParticipants,
  getCurrentCard,
  setCurrentCard,
  getAdminToken,
  setAdminToken,
  adminPing,
  getAdminTasks,
  saveAdminTasks,
  getAdminBoards,
  saveAdminBoards,
  getAdminPrivate,
  uploadAdminPrivate,
  deleteAdminPrivate,
  AdminAuthError,
} from './api';
import ObsView from './ObsView';
import ObsBar from './ObsBar';
import ObsCycle from './ObsCycle';
import ObsCard from './ObsCard';

const REFRESH_MS = 30_000;

const DELTA_EPS = 0.01;

function getDir(current, previous) {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous)
  ) {
    return null;
  }
  if (current - previous > DELTA_EPS) return 'up';
  if (previous - current > DELTA_EPS) return 'down';
  return null;
}

function DeltaCell({ value, prev, digits = 2, extraClass = '' }) {
  const dir = getDir(value, prev);
  return (
    <td className={`mono ${extraClass}`.trim()}>
      {value !== undefined && value !== null ? value.toFixed(digits) : '-'}
      {dir === 'up' ? <span className="delta-arrow up"> ▲</span> : null}
      {dir === 'down' ? <span className="delta-arrow down"> ▼</span> : null}
    </td>
  );
}

function rowDirClass(dir) {
  return dir === 'up' ? 'row-up' : dir === 'down' ? 'row-down' : '';
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function DownloadButton({ onClick }) {
  return (
    <button className="control-btn control-btn-ghost" onClick={onClick} title="Скачать CSV">
      ↓ CSV
    </button>
  );
}

function ModeToggle({ mode, onChange }) {
  return (
    <div className="mode-toggle">
      <button
        className={`mode-toggle-btn ${mode === 'public' ? 'active' : ''}`}
        onClick={() => onChange('public')}
      >
        Public
      </button>
      <button
        className={`mode-toggle-btn ${mode === 'private' ? 'active' : ''}`}
        onClick={() => onChange('private')}
      >
        Private
      </button>
    </div>
  );
}

function FilterToggle({ value, onChange }) {
  return (
    <div className="mode-toggle">
      <button
        className={`mode-toggle-btn ${value === 'all' ? 'active' : ''}`}
        onClick={() => onChange('all')}
      >
        Все
      </button>
      <button
        className={`mode-toggle-btn ${value === 'ours' ? 'active' : ''}`}
        onClick={() => onChange('ours')}
      >
        Только наши
      </button>
    </div>
  );
}

function useOurKaggleSet() {
  const [set, setSet] = useState(null);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await getParticipants();
        if (!active) return;
        const ids = (data.participants || [])
          .map((p) => (p.kaggleId || '').toString().trim().toLowerCase())
          .filter(Boolean);
        setSet(new Set(ids));
      } catch {
        if (active) setSet(new Set());
      }
    }
    load();
    return () => { active = false; };
  }, []);
  return set;
}

function applyFilter(rows, ourSet, enabled) {
  if (!enabled || !ourSet) return rows;
  return rows.filter((r) => ourSet.has((r.nickname || '').toLowerCase()));
}

function reseatPlaces(rows) {
  return rows.map((r, i) => ({ ...r, place: i + 1 }));
}

function usePolling(loader, deps = []) {
  const [state, setState] = useState({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const data = await loader();
        if (!active) return;
        setState({ data, loading: false, error: null });
      } catch (error) {
        if (!active) return;
        setState({ data: null, loading: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    run();
    const timer = setInterval(run, REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, deps);

  return state;
}

function sortedVisibleBoards(boards) {
  return (boards || [])
    .filter((b) => b.visible !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function Layout({ children, tasks, boards }) {
  const visibleBoards = sortedVisibleBoards(boards);
  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Northern Eurasia Olympiad in Artificial Intelligence 2026</p>
        <h1>NEOAI</h1>
        <p className="subtitle">Live Leaderboard · нормализация: top1 = 100, last = 0. Общий балл = сумма по всем задачам.</p>
      </header>

      <nav className="tabs">
        <NavLink to="/leaderboard" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          Общий ЛБ
        </NavLink>
        {visibleBoards.map((board) => (
          <NavLink key={board.slug} to={`/board/${board.slug}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {board.title}
          </NavLink>
        ))}
        {tasks.map((task) => (
          <NavLink key={task.slug} to={`/task/${task.slug}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {task.title}
          </NavLink>
        ))}
      </nav>

      <main>{children}</main>
    </div>
  );
}

function ErrorBanner({ errors }) {
  if (!errors || errors.length === 0) {
    return null;
  }

  return (
    <div className="error-box">
      <strong>Проблема с обновлением данных:</strong>
      <ul>
        {errors.map((e, idx) => (
          <li key={idx}>{e.message}</li>
        ))}
      </ul>
    </div>
  );
}

function OverallPage() {
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);
  const [mode, setMode] = useState('public');
  const [filter, setFilter] = useState('all');
  const ourSet = useOurKaggleSet();

  if (loading) return <p className="status">Загрузка общего ЛБ...</p>;
  if (error) return <p className="status error">{error}</p>;
  if (!data?.updatedAt) return <p className="status">Бэк прогревается — идёт первое обновление с Kaggle, попробуй через минуту…</p>;

  const isPrivate = mode === 'private';
  const overallSrc = isPrivate ? (data.privateOverall || []) : data.overall;
  const overall = reseatPlaces(applyFilter(overallSrc, ourSet, filter === 'ours'));
  const privateAvailable = (data.privateTaskSlugs || []).length > 0;

  function exportCSV() {
    const headers = ['#', 'Nickname', 'Team Name', 'Total points', ...data.tasks.map((t) => t.title)];
    const rows = overall.map((row) => [
      row.place,
      row.nickname || '',
      row.teamName || '',
      row.totalPoints.toFixed(2),
      ...data.tasks.map((t) => {
        const p = row.tasks?.[t.slug]?.points;
        return p !== undefined ? p.toFixed(2) : (isPrivate ? '0.00' : '');
      }),
    ]);
    downloadCSV(`overall${isPrivate ? '-private' : ''}.csv`, headers, rows);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Общий рейтинг</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterToggle value={filter} onChange={setFilter} />
          <ModeToggle mode={mode} onChange={setMode} />
          <DownloadButton onClick={exportCSV} />
          <span>Updated: {new Date(data.updatedAt).toLocaleString()}</span>
        </div>
      </div>

      <ErrorBanner errors={data.errors} />

      {isPrivate && !privateAvailable ? (
        <p className="status" style={{ margin: 24 }}>Приват ещё не посчитался — ни по одной задаче не загружен private CSV.</p>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nickname</th>
              <th>Team Name</th>
              <th>Total points</th>
              {data.tasks.map((task) => (
                <th key={task.slug}>{task.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {overall.map((row) => (
              <tr key={row.participantKey} className={rowDirClass(getDir(row.totalPoints, row.previousTotalPoints))}>
                <td>{row.place}</td>
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <DeltaCell value={row.totalPoints} prev={row.previousTotalPoints} />
                {data.tasks.map((task) => {
                  const cell = row.tasks?.[task.slug];
                  if (!cell && isPrivate) {
                    return <td key={task.slug} className="mono muted">0.00</td>;
                  }
                  return (
                    <DeltaCell
                      key={task.slug}
                      value={cell?.points}
                      prev={cell?.previousPoints}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

function CyclingOverallPage() {
  const PAGE_SIZE = 15;
  const PAGE_MS = 20_000;

  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);
  const [pageIdx, setPageIdx] = useState(0);
  const [filter, setFilter] = useState('all');
  const ourSet = useOurKaggleSet();

  useEffect(() => {
    const timer = setInterval(() => setPageIdx((p) => p + 1), PAGE_MS);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <p className="status">Загрузка общего ЛБ...</p>;
  if (error) return <p className="status error">{error}</p>;
  if (!data?.updatedAt) return <p className="status">Бэк прогревается — идёт первое обновление с Kaggle…</p>;

  const filteredOverall = reseatPlaces(applyFilter(data.overall, ourSet, filter === 'ours'));
  const total = filteredOverall.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = pageIdx % totalPages;
  const start = currentPage * PAGE_SIZE;
  const slice = filteredOverall.slice(start, start + PAGE_SIZE);
  const endShown = Math.min(start + PAGE_SIZE, total);

  function exportCSV() {
    const headers = ['#', 'Nickname', 'Team Name', 'Total points', ...data.tasks.map((t) => t.title)];
    const rows = filteredOverall.map((row) => [
      row.place,
      row.nickname || '',
      row.teamName || '',
      row.totalPoints.toFixed(2),
      ...data.tasks.map((t) => {
        const p = row.tasks?.[t.slug]?.points;
        return p !== undefined ? p.toFixed(2) : '';
      }),
    ]);
    downloadCSV('overall.csv', headers, rows);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Места {start + 1}–{endShown}</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterToggle value={filter} onChange={setFilter} />
          <DownloadButton onClick={exportCSV} />
          <span>
            Страница {currentPage + 1} / {totalPages} · смена каждые {PAGE_MS / 1000}с · updated:{' '}
            {new Date(data.updatedAt).toLocaleString()}
          </span>
        </div>
      </div>

      <ErrorBanner errors={data.errors} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nickname</th>
              <th>Team Name</th>
              <th>Total points</th>
              {data.tasks.map((task) => (
                <th key={task.slug}>{task.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr key={row.participantKey} className={rowDirClass(getDir(row.totalPoints, row.previousTotalPoints))}>
                <td>{row.place}</td>
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <DeltaCell value={row.totalPoints} prev={row.previousTotalPoints} />
                {data.tasks.map((task) => {
                  const cell = row.tasks?.[task.slug];
                  return (
                    <DeltaCell
                      key={task.slug}
                      value={cell?.points}
                      prev={cell?.previousPoints}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BoardPage({ boards }) {
  const { slug } = useParams();
  const board = (boards || []).find((b) => b.slug === slug);
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);
  const [mode, setMode] = useState('public');
  const [filter, setFilter] = useState('all');
  const ourSet = useOurKaggleSet();

  if (!board) return <p className="status error">Лидерборд '{slug}' не найден.</p>;
  if (loading) return <p className="status">Загрузка лидерборда...</p>;
  if (error) return <p className="status error">{error}</p>;
  if (!data?.updatedAt) return <p className="status">Бэк прогревается — идёт первое обновление с Kaggle…</p>;

  const isPrivate = mode === 'private';
  const overallRaw = isPrivate ? (data.privateOverall || []) : data.overall;
  const overallSrc = applyFilter(overallRaw, ourSet, filter === 'ours');
  const privateTaskSlugs = new Set(data.privateTaskSlugs || []);
  const boardHasPrivate = board.taskSlugs.some((s) => privateTaskSlugs.has(s));

  const presentSlugs = board.taskSlugs.filter((s) => data.tasks.some((t) => t.slug === s));
  const groupTasks = data.tasks.filter((t) => presentSlugs.includes(t.slug));

  const ranked = overallSrc
    .map((row) => {
      const total = presentSlugs.reduce((sum, slug) => sum + (row.tasks?.[slug]?.points ?? 0), 0);
      const hasAnyPrev = presentSlugs.some((slug) => row.tasks?.[slug]?.previousPoints != null);
      const prevTotal = hasAnyPrev
        ? presentSlugs.reduce(
            (sum, slug) => sum + (row.tasks?.[slug]?.previousPoints ?? row.tasks?.[slug]?.points ?? 0),
            0
          )
        : null;
      return {
        ...row,
        groupPoints: Number(total.toFixed(6)),
        previousGroupPoints: prevTotal != null ? Number(prevTotal.toFixed(6)) : null,
      };
    })
    .filter((row) => presentSlugs.some((slug) => row.tasks?.[slug] !== undefined))
    .sort(
      (a, b) =>
        b.groupPoints - a.groupPoints ||
        (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
    )
    .map((row, i) => ({ ...row, place: i + 1 }));

  function exportCSV() {
    const headers = ['#', 'Nickname', 'Team Name', 'Board points', ...groupTasks.map((t) => t.title)];
    const rows = ranked.map((row) => [
      row.place,
      row.nickname || '',
      row.teamName || '',
      row.groupPoints.toFixed(2),
      ...groupTasks.map((t) => {
        const p = row.tasks?.[t.slug]?.points;
        return p !== undefined ? p.toFixed(2) : (isPrivate ? '0.00' : '');
      }),
    ]);
    downloadCSV(`board-${board.slug}${isPrivate ? '-private' : ''}.csv`, headers, rows);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{board.title}</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterToggle value={filter} onChange={setFilter} />
          <ModeToggle mode={mode} onChange={setMode} />
          <DownloadButton onClick={exportCSV} />
          <span>Updated: {new Date(data.updatedAt).toLocaleString()}</span>
        </div>
      </div>

      <ErrorBanner errors={data.errors} />

      {isPrivate && !boardHasPrivate ? (
        <p className="status" style={{ margin: 24 }}>Приват ещё не посчитался — ни по одной задаче этого борда не загружен private CSV.</p>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nickname</th>
              <th>Team Name</th>
              <th>Board points</th>
              {groupTasks.map((task) => (
                <th key={task.slug}>{task.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <tr key={row.participantKey} className={rowDirClass(getDir(row.groupPoints, row.previousGroupPoints))}>
                <td>{row.place}</td>
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <DeltaCell value={row.groupPoints} prev={row.previousGroupPoints} />
                {groupTasks.map((task) => {
                  const cell = row.tasks?.[task.slug];
                  if (!cell && isPrivate) {
                    return <td key={task.slug} className="mono muted">0.00</td>;
                  }
                  return (
                    <DeltaCell
                      key={task.slug}
                      value={cell?.points}
                      prev={cell?.previousPoints}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

function TaskPage() {
  const { slug } = useParams();
  const { data, loading, error } = usePolling(() => getTaskLeaderboard(slug), [slug]);
  const [mode, setMode] = useState('public');
  const [filter, setFilter] = useState('all');
  const ourSet = useOurKaggleSet();

  if (loading) return <p className="status">Загрузка ЛБ задачи...</p>;
  if (error) return <p className="status error">{error}</p>;

  const isPrivate = mode === 'private';
  const task = isPrivate ? (data.privateTask || data.task) : data.task;
  const entriesRaw = isPrivate ? (data.privateTask?.entries || []) : data.task.entries;
  const entries = reseatPlaces(applyFilter(entriesRaw, ourSet, filter === 'ours'));
  const privateAvailable = !!data.privateTask;

  function exportCSV() {
    const headers = ['#', 'Nickname', 'Team Name', 'Kaggle Rank', 'Raw Score', 'NEOAI Points'];
    const rows = entries.map((row) => [
      row.place,
      row.nickname || '',
      row.teamName || '',
      row.rank ?? '',
      row.score.toFixed(6),
      row.points.toFixed(2),
    ]);
    downloadCSV(`task-${task.slug}${isPrivate ? '-private' : ''}.csv`, headers, rows);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{task.title}</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterToggle value={filter} onChange={setFilter} />
          <ModeToggle mode={mode} onChange={setMode} />
          <DownloadButton onClick={exportCSV} />
          <span>Updated: {new Date(data.updatedAt).toLocaleString()}</span>
        </div>
      </div>

      <ErrorBanner errors={data.errors} />

      {isPrivate && !privateAvailable ? (
        <p className="status" style={{ margin: 24 }}>Приват ещё не посчитался — для этой задачи private CSV не загружен.</p>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nickname</th>
              <th>Team Name</th>
              <th>Kaggle Rank</th>
              <th>Raw Score</th>
              <th>NEOAI Points</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.participantKey} className={rowDirClass(getDir(row.points, row.previousPoints))}>
                <td>{row.place}</td>
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <td className="mono">{row.rank ?? '-'}</td>
                <td className="mono">{row.score.toFixed(6)}</td>
                <DeltaCell value={row.points} prev={row.previousPoints} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

function ObsOverall() {
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);
  const ourSet = useOurKaggleSet();
  const rows = applyFilter(data?.overall || [], ourSet, true).map((r) => ({
    key: r.participantKey,
    name: r.nickname || r.teamName || '-',
    score: r.totalPoints.toFixed(2),
    dir: getDir(r.totalPoints, r.previousTotalPoints),
  }));
  return (
    <ObsView
      contextLabel="Общий зачёт"
      rows={rows}
      updatedAt={data?.updatedAt}
      loading={loading}
      error={error}
    />
  );
}

function ObsBoard() {
  const { slug } = useParams();
  const boardsState = usePolling(() => getBoards(), []);
  const board = (boardsState.data?.boards || []).find((b) => b.slug === slug);
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);
  const ourSet = useOurKaggleSet();

  if (!boardsState.loading && !board) {
    return <ObsView contextLabel="Лидерборд не найден" rows={[]} loading={false} error={`Лидерборд '${slug}' не найден`} />;
  }
  if (boardsState.loading) {
    return <ObsView contextLabel="Загрузка..." rows={[]} loading={true} />;
  }

  const presentSlugs = (data?.tasks || [])
    .filter((t) => board.taskSlugs.includes(t.slug))
    .map((t) => t.slug);

  const rows = applyFilter(data?.overall || [], ourSet, true)
    .map((r) => {
      const total = presentSlugs.reduce((sum, slug) => sum + (r.tasks?.[slug]?.points ?? 0), 0);
      const hasAnyPrev = presentSlugs.some((slug) => r.tasks?.[slug]?.previousPoints != null);
      const prevTotal = hasAnyPrev
        ? presentSlugs.reduce(
            (sum, slug) => sum + (r.tasks?.[slug]?.previousPoints ?? r.tasks?.[slug]?.points ?? 0),
            0
          )
        : null;
      return { ...r, groupPoints: total, previousGroupPoints: prevTotal };
    })
    .filter((r) => presentSlugs.some((slug) => r.tasks?.[slug] !== undefined))
    .sort(
      (a, b) =>
        b.groupPoints - a.groupPoints ||
        (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
    )
    .map((r) => ({
      key: r.participantKey,
      name: r.nickname || r.teamName || '-',
      score: r.groupPoints.toFixed(2),
      dir: getDir(r.groupPoints, r.previousGroupPoints),
    }));

  return (
    <ObsView
      contextLabel={board.title}
      rows={rows}
      updatedAt={data?.updatedAt}
      loading={loading}
      error={error}
    />
  );
}

function formatRawScore(score) {
  if (!Number.isFinite(score)) return '-';
  const trimmed = Number(score.toFixed(6)).toString();
  return trimmed;
}

function ObsTask() {
  const { slug } = useParams();
  const { data, loading, error } = usePolling(() => getTaskLeaderboard(slug), [slug]);
  const ourSet = useOurKaggleSet();

  const task = data?.task;
  const rows = applyFilter(task?.entries || [], ourSet, true).map((r) => ({
    key: r.participantKey,
    name: r.nickname || r.teamName || '-',
    score: formatRawScore(r.score),
    dir: getDir(r.points, r.previousPoints),
  }));

  return (
    <ObsView
      contextLabel={task?.title || ''}
      rows={rows}
      updatedAt={data?.updatedAt}
      loading={loading}
      error={error}
    />
  );
}

function ObsBoardBar() {
  const { slug } = useParams();
  const boardsState = usePolling(() => getBoards(), []);
  const board = (boardsState.data?.boards || []).find((b) => b.slug === slug);
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);
  const ourSet = useOurKaggleSet();

  if (!boardsState.loading && !board) {
    return <ObsBar contextLabel="—" rows={[]} loading={false} error={`Лидерборд '${slug}' не найден`} />;
  }
  if (boardsState.loading) {
    return <ObsBar contextLabel="Загрузка..." rows={[]} loading={true} />;
  }

  const groupTasks = (data?.tasks || []).filter((t) => board.taskSlugs.includes(t.slug));
  const presentSlugs = groupTasks.map((t) => t.slug);

  const taskLabels = groupTasks.map((t, i) => {
    const m = t.slug.match(/(\d+)/);
    const short = m ? `T${m[1]}` : `T${i + 1}`;
    return { slug: t.slug, short };
  });

  const rows = applyFilter(data?.overall || [], ourSet, true)
    .map((r) => {
      const total = presentSlugs.reduce((sum, slug) => sum + (r.tasks?.[slug]?.points ?? 0), 0);
      const hasAnyPrev = presentSlugs.some((slug) => r.tasks?.[slug]?.previousPoints != null);
      const prevTotal = hasAnyPrev
        ? presentSlugs.reduce(
            (sum, slug) => sum + (r.tasks?.[slug]?.previousPoints ?? r.tasks?.[slug]?.points ?? 0),
            0
          )
        : null;
      return { ...r, groupPoints: total, previousGroupPoints: prevTotal };
    })
    .filter((r) => presentSlugs.some((slug) => r.tasks?.[slug] !== undefined))
    .sort(
      (a, b) =>
        b.groupPoints - a.groupPoints ||
        (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
    )
    .map((r) => ({
      key: r.participantKey,
      name: r.nickname || r.teamName || '-',
      score: r.groupPoints.toFixed(2),
      dir: getDir(r.groupPoints, r.previousGroupPoints),
      taskPoints: taskLabels.map(({ slug, short }) => ({
        slug,
        short,
        points: r.tasks?.[slug]?.points,
        dir: getDir(r.tasks?.[slug]?.points, r.tasks?.[slug]?.previousPoints),
      })),
    }));

  return (
    <ObsBar
      contextLabel={board.title}
      rows={rows}
      updatedAt={data?.updatedAt}
      loading={loading}
      error={error}
    />
  );
}

function ControlPage() {
  const [list, setList] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const data = await getParticipants();
      setList(data.participants || []);
      setCurrentId(data.currentId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  async function pick(id) {
    setBusy(true);
    setError(null);
    try {
      const data = await setCurrentCard(id);
      setCurrentId(data.currentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const filtered = list.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Карточка участника — управление</h2>
        <span>OBS: <code>/obs/card</code> · обновляется каждые 2с</span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="control-body">
        <div className="control-current">
          <span className="control-label">Сейчас в OBS:</span>
          <strong>
            {list.find((p) => p.id === currentId)?.name || (currentId ? currentId : '— ничего не выбрано —')}
          </strong>
          {currentId ? (
            <button className="control-btn control-btn-ghost" disabled={busy} onClick={() => pick(null)}>
              Скрыть
            </button>
          ) : null}
        </div>

        <div className="control-search">
          <input
            type="text"
            placeholder="Поиск по имени..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="control-input"
          />
        </div>

        <div className="control-list">
          {filtered.length === 0 ? (
            <p className="status">Ничего не найдено.</p>
          ) : (
            filtered.map((p) => {
              const active = p.id === currentId;
              return (
                <button
                  key={p.id}
                  disabled={busy}
                  onClick={() => pick(p.id)}
                  className={`control-item ${active ? 'active' : ''}`}
                >
                  <span className="control-item-name">{p.name}</span>
                  {p.kaggleId ? (
                    <span className="control-item-id">@{p.kaggleId}</span>
                  ) : (
                    <span className="control-item-id" style={{ color: 'var(--danger)' }}>
                      нет kaggleId
                    </span>
                  )}
                  {active ? <span className="control-item-badge">в эфире</span> : null}
                </button>
              );
            })
          )}
        </div>

        <p className="meta">
          Список редактируется в <code>backend/data/participants.json</code> (нужен рестарт backend, если файл не подхватывается).
        </p>
      </div>
    </section>
  );
}

function SitemapPage({ tasks, boards }) {
  const visibleBoards = sortedVisibleBoards(boards);
  const allBoards = (boards || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Все страницы</h2>
        <span>динамический список по tasks/boards с бэка</span>
      </div>

      <div className="sitemap">
        <div className="sitemap-group">
          <h3>Публичные таблицы</h3>
          <ul>
            <li><Link to="/leaderboard">/leaderboard</Link> — общий лидерборд по сумме всех задач</li>
            <li><Link to="/cycle">/cycle</Link> — общий ЛБ, циклически по 15 строк (для табло, скрыт из нав-меню)</li>
            {allBoards.map((b) => (
              <li key={b.slug}>
                <Link to={`/board/${b.slug}`}>/board/{b.slug}</Link> — борд «{b.title}»
                {b.visible === false ? ' (скрыт из навигации)' : ''}
              </li>
            ))}
            {(tasks || []).map((t) => (
              <li key={t.slug}>
                <Link to={`/task/${t.slug}`}>/task/{t.slug}</Link> — задача «{t.title}»
              </li>
            ))}
          </ul>
        </div>

        <div className="sitemap-group">
          <h3>Админка (нужен пароль)</h3>
          <ul>
            <li><Link to="/admin">/admin</Link> — вход</li>
            <li><Link to="/admin/tasks">/admin/tasks</Link> — редактирование задач (slug, title, competition, baseline/author)</li>
            <li><Link to="/admin/boards">/admin/boards</Link> — редактирование лидербордов (выборка задач + видимость + порядок)</li>
            <li><Link to="/admin/card">/admin/card</Link> — выбор активной карточки участника для OBS</li>
          </ul>
        </div>

        <div className="sitemap-group">
          <h3>OBS-оверлеи</h3>
          <p className="meta" style={{ padding: 0, border: 'none' }}>
            Под Browser Source в OBS. Без шапки/нав, тёмный фон под chroma-key.
          </p>
          <ul>
            <li><Link to="/obs/overall">/obs/overall</Link> — общий top-15 текстовыми строками</li>
            <li><Link to="/obs/cycle">/obs/cycle</Link> — общий ЛБ, цикл по 15</li>
            <li><Link to="/obs/card">/obs/card</Link> — карточка текущего активного участника</li>
            {visibleBoards.map((b) => (
              <li key={`obs-${b.slug}`}>
                <Link to={`/obs/board/${b.slug}`}>/obs/board/{b.slug}</Link> — top-15 борда «{b.title}» (строки)
                {' · '}
                <Link to={`/obs/bar/board/${b.slug}`}>/obs/bar/board/{b.slug}</Link> — он же баром с per-task chip'ами
              </li>
            ))}
            {(tasks || []).map((t) => (
              <li key={`obs-task-${t.slug}`}>
                <Link to={`/obs/task/${t.slug}`}>/obs/task/{t.slug}</Link> — задача «{t.title}»
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function MainShell() {
  const [tasks, setTasks] = useState([]);
  const [boards, setBoards] = useState([]);
  const [tasksError, setTasksError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [t, b] = await Promise.all([getTasks(), getBoards()]);
        if (!active) return;
        setTasks(t.tasks || []);
        setBoards(b.boards || []);
        setTasksError(null);
      } catch (error) {
        if (!active) return;
        setTasksError(error instanceof Error ? error.message : String(error));
      }
    }

    load();
    const timer = setInterval(load, REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Layout tasks={tasks} boards={boards}>
      {tasksError ? <p className="status error">{tasksError}</p> : null}

      <Routes>
        <Route path="/" element={<Navigate to="/leaderboard" replace />} />
        <Route path="/leaderboard" element={<OverallPage />} />
        <Route path="/cycle" element={<CyclingOverallPage />} />
        <Route path="/control" element={<Navigate to="/admin/card" replace />} />
        <Route path="/board/:slug" element={<BoardPage boards={boards} />} />
        <Route path="/task/:slug" element={<TaskPage />} />
        <Route path="/routes" element={<SitemapPage tasks={tasks} boards={boards} />} />
        <Route path="*" element={<p className="status">Страница не найдена. <Link to="/leaderboard">Вернуться</Link></p>} />
      </Routes>
    </Layout>
  );
}

function AdminLogin({ onSuccess }) {
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAdminToken(pwd);
    try {
      await adminPing();
      onSuccess();
    } catch (err) {
      setAdminToken('');
      if (err instanceof AdminAuthError) setError('Неверный пароль');
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel admin-login">
      <div className="panel-head">
        <h2>Админка</h2>
      </div>
      <form onSubmit={submit} className="admin-login-form">
        <input
          type="password"
          autoFocus
          placeholder="Пароль администратора"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          className="control-input"
        />
        <button type="submit" disabled={busy || !pwd} className="control-btn">
          {busy ? 'Проверка...' : 'Войти'}
        </button>
        {error ? <div className="error-box">{error}</div> : null}
      </form>
    </section>
  );
}

function PrivateRow({ slug }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    if (!slug) return;
    setError(null);
    try {
      const data = await getAdminPrivate(slug);
      setInfo(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
  }, [slug]);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const r = await uploadAdminPrivate(slug, text);
      setInfo({ exists: true, count: r.count, updatedAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Удалить приват для ${slug}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAdminPrivate(slug);
      setInfo({ exists: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!slug) return null;

  return (
    <div className="admin-private-row">
      <span className="admin-private-label">private:</span>
      {info?.exists ? (
        <>
          <span className="muted">{info.count} строк, обновлено {new Date(info.updatedAt).toLocaleString()}</span>
          <button className="control-btn control-btn-ghost" onClick={remove} disabled={busy}>×</button>
        </>
      ) : (
        <span className="muted">не загружено</span>
      )}
      <label className="control-btn control-btn-ghost" style={{ cursor: 'pointer' }}>
        {busy ? '...' : info?.exists ? '↑ заменить CSV' : '↑ загрузить CSV'}
        <input type="file" accept=".csv,text/csv" onChange={pick} disabled={busy} style={{ display: 'none' }} />
      </label>
      {error ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}

function AdminTasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  function normalize(rawList) {
    return (rawList || []).map((t) => ({
      slug: t.slug || '',
      title: t.title || '',
      competition: t.competition || '',
      higherIsBetter: t.higherIsBetter !== false,
      baselineScore: t.baselineScore == null ? '' : String(t.baselineScore),
      authorScore: t.authorScore == null ? '' : String(t.authorScore),
    }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminTasks();
      const list = normalize(data.tasks);
      setTasks(list);
      setOriginal(JSON.stringify(list));
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(idx, patch) {
    setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  }

  function move(idx, dir) {
    setTasks((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  function remove(idx) {
    setTasks((prev) => prev.filter((_, i) => i !== idx));
  }

  function add() {
    setTasks((prev) => [
      ...prev,
      { slug: '', title: '', competition: '', higherIsBetter: true, baselineScore: '', authorScore: '' },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await saveAdminTasks(tasks);
      const list = normalize(data.tasks);
      setTasks(list);
      setOriginal(JSON.stringify(list));
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(tasks) !== original;

  if (loading) return <p className="status">Загрузка задач...</p>;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Задачи (tasks.json)</h2>
        <span>
          {dirty ? 'есть несохранённые изменения' : savedAt ? `сохранено ${savedAt.toLocaleTimeString()}` : 'без изменений'}
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="admin-tasks">
        <div className="admin-tasks-head">
          <span style={{ width: 30 }}>#</span>
          <span style={{ flex: '0 0 160px' }}>slug</span>
          <span style={{ flex: '0 0 220px' }}>title</span>
          <span style={{ flex: 1 }}>competition</span>
          <span style={{ flex: '0 0 110px', textAlign: 'center' }}>higherIsBetter</span>
          <span style={{ flex: '0 0 100px' }}>baseline</span>
          <span style={{ flex: '0 0 100px' }}>author</span>
          <span style={{ flex: '0 0 140px' }}></span>
        </div>

        {tasks.map((task, idx) => (
          <div key={idx} className="admin-tasks-task">
          <div className="admin-tasks-row">
            <span style={{ width: 30 }} className="muted">{idx + 1}</span>
            <input
              className="control-input"
              style={{ flex: '0 0 160px' }}
              value={task.slug}
              onChange={(e) => update(idx, { slug: e.target.value })}
              placeholder="task-1"
            />
            <input
              className="control-input"
              style={{ flex: '0 0 220px' }}
              value={task.title}
              onChange={(e) => update(idx, { title: e.target.value })}
              placeholder="NEOAI Task 1"
            />
            <input
              className="control-input"
              style={{ flex: 1 }}
              value={task.competition}
              onChange={(e) => update(idx, { competition: e.target.value })}
              placeholder="kaggle-competition-slug"
            />
            <label style={{ flex: '0 0 110px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={task.higherIsBetter}
                onChange={(e) => update(idx, { higherIsBetter: e.target.checked })}
              />
            </label>
            <input
              className="control-input"
              style={{ flex: '0 0 100px' }}
              type="number"
              step="any"
              value={task.baselineScore}
              onChange={(e) => update(idx, { baselineScore: e.target.value })}
              placeholder=""
            />
            <input
              className="control-input"
              style={{ flex: '0 0 100px' }}
              type="number"
              step="any"
              value={task.authorScore}
              onChange={(e) => update(idx, { authorScore: e.target.value })}
              placeholder=""
            />
            <span style={{ flex: '0 0 140px', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button className="control-btn control-btn-ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>↑</button>
              <button className="control-btn control-btn-ghost" onClick={() => move(idx, 1)} disabled={idx === tasks.length - 1}>↓</button>
              <button className="control-btn control-btn-ghost" onClick={() => remove(idx)}>×</button>
            </span>
          </div>
          <PrivateRow slug={task.slug} />
          </div>
        ))}

        <div className="admin-tasks-actions">
          <button className="control-btn control-btn-ghost" onClick={add}>+ задача</button>
          <button className="control-btn control-btn-ghost" onClick={load} disabled={saving}>Откатить</button>
          <button className="control-btn" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>

        <p className="meta">
          После сохранения бэк перезапускает Kaggle-обновление автоматически.
          Если заданы baseline и author — баллы считаются как (score − baseline) / (author − baseline) × 100;
          иначе фолбэк на старую нормировку (top1 = 100, last = 0).
        </p>
      </div>
    </section>
  );
}

function AdminBoardsPage() {
  const navigate = useNavigate();
  const [boards, setBoards] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  function normalize(rawList, knownSet) {
    return (rawList || []).map((b) => ({
      slug: b.slug || '',
      title: b.title || '',
      taskSlugs: Array.isArray(b.taskSlugs)
        ? b.taskSlugs.filter((s) => !knownSet || knownSet.has(s))
        : [],
      visible: b.visible !== false,
      order: b.order ?? 0,
    }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [b, t] = await Promise.all([getAdminBoards(), getAdminTasks()]);
      const tasksList = t.tasks || [];
      const known = new Set(tasksList.map((x) => x.slug));
      const list = normalize(b.boards, known);
      setBoards(list);
      setAllTasks(tasksList);
      setOriginal(JSON.stringify(list));
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(idx, patch) {
    setBoards((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }

  function toggleTask(idx, slug) {
    setBoards((prev) =>
      prev.map((b, i) => {
        if (i !== idx) return b;
        const has = b.taskSlugs.includes(slug);
        return {
          ...b,
          taskSlugs: has ? b.taskSlugs.filter((s) => s !== slug) : [...b.taskSlugs, slug],
        };
      })
    );
  }

  function remove(idx) {
    if (!confirm('Удалить лидерборд?')) return;
    setBoards((prev) => prev.filter((_, i) => i !== idx));
  }

  function add() {
    const nextOrder = boards.reduce((m, b) => Math.max(m, b.order ?? 0), 0) + 1;
    setBoards((prev) => [
      ...prev,
      { slug: '', title: '', taskSlugs: [], visible: true, order: nextOrder },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await saveAdminBoards(boards);
      const known = new Set(allTasks.map((x) => x.slug));
      const list = normalize(data.boards, known);
      setBoards(list);
      setOriginal(JSON.stringify(list));
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(boards) !== original;

  if (loading) return <p className="status">Загрузка лидербордов...</p>;

  const sorted = boards
    .map((b, i) => ({ b, i }))
    .sort((a, b) => (a.b.order ?? 0) - (b.b.order ?? 0));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Лидерборды (boards.json)</h2>
        <span>
          {dirty ? 'есть несохранённые изменения' : savedAt ? `сохранено ${savedAt.toLocaleTimeString()}` : 'без изменений'}
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="admin-boards">
        {sorted.length === 0 ? (
          <p className="meta">Пока ни одного лидерборда. Создай первый.</p>
        ) : null}

        {sorted.map(({ b: board, i: idx }) => (
          <div key={idx} className="admin-board-card">
            <div className="admin-board-row">
              <label className="admin-field">
                <span className="admin-field-label">slug</span>
                <input
                  className="control-input"
                  value={board.slug}
                  onChange={(e) => update(idx, { slug: e.target.value })}
                  placeholder="round-1"
                />
              </label>
              <label className="admin-field" style={{ flex: 1 }}>
                <span className="admin-field-label">название</span>
                <input
                  className="control-input"
                  value={board.title}
                  onChange={(e) => update(idx, { title: e.target.value })}
                  placeholder="1 тур"
                />
              </label>
              <label className="admin-field" style={{ flex: '0 0 90px' }}>
                <span className="admin-field-label">order</span>
                <input
                  className="control-input"
                  type="number"
                  value={board.order}
                  onChange={(e) => update(idx, { order: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="admin-field admin-field-check">
                <span className="admin-field-label">visible</span>
                <input
                  type="checkbox"
                  checked={board.visible}
                  onChange={(e) => update(idx, { visible: e.target.checked })}
                />
              </label>
              <button className="control-btn control-btn-ghost" onClick={() => remove(idx)}>×</button>
            </div>

            <div className="admin-board-tasks">
              <div className="admin-field-label">задачи в лидерборде</div>
              <div className="admin-board-tasks-list">
                {allTasks.length === 0 ? (
                  <span className="meta">Нет задач — создай их во вкладке «Задачи»</span>
                ) : (
                  allTasks.map((t) => (
                    <label key={t.slug} className="admin-board-task-pick">
                      <input
                        type="checkbox"
                        checked={board.taskSlugs.includes(t.slug)}
                        onChange={() => toggleTask(idx, t.slug)}
                      />
                      <span>{t.title}</span>
                      <span className="muted"> ({t.slug})</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        ))}

        <div className="admin-tasks-actions">
          <button className="control-btn control-btn-ghost" onClick={add}>+ лидерборд</button>
          <button className="control-btn control-btn-ghost" onClick={load} disabled={saving}>Откатить</button>
          <button className="control-btn" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>

        <p className="meta">
          Видимые лидерборды появятся вкладками в публичной навигации. URL: <code>/board/&lt;slug&gt;</code>;
          OBS: <code>/obs/board/&lt;slug&gt;</code> и <code>/obs/bar/board/&lt;slug&gt;</code>.
        </p>
      </div>
    </section>
  );
}

function AdminShell() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(() => Boolean(getAdminToken()));

  useEffect(() => {
    function onStorage() {
      setAuthed(Boolean(getAdminToken()));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function logout() {
    setAdminToken('');
    setAuthed(false);
    navigate('/admin', { replace: true });
  }

  if (!authed) {
    const login = <AdminLogin onSuccess={() => setAuthed(true)} />;
    return (
      <div className="page">
        <header className="hero">
          <p className="eyebrow">NEOAI · admin</p>
          <h1>Вход</h1>
        </header>
        <main>
          <Routes>
            <Route path="/" element={login} />
            <Route path="tasks" element={login} />
            <Route path="card" element={login} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">NEOAI · admin</p>
        <h1>Админка</h1>
      </header>

      <nav className="tabs">
        <NavLink to="/admin/tasks" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          Задачи
        </NavLink>
        <NavLink to="/admin/boards" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          Лидерборды
        </NavLink>
        <NavLink to="/admin/card" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          Карточка
        </NavLink>
        <NavLink to="/leaderboard" className="tab">← Лидерборд</NavLink>
        <button onClick={logout} className="tab" style={{ marginLeft: 'auto' }}>
          Выйти
        </button>
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/admin/tasks" replace />} />
          <Route path="tasks" element={<AdminTasksPage />} />
          <Route path="boards" element={<AdminBoardsPage />} />
          <Route path="card" element={<ControlPage />} />
          <Route path="*" element={<Navigate to="/admin/tasks" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/obs/overall" element={<ObsOverall />} />
      <Route path="/obs/board/:slug" element={<ObsBoard />} />
      <Route path="/obs/task/:slug" element={<ObsTask />} />
      <Route path="/obs/bar/board/:slug" element={<ObsBoardBar />} />
      <Route path="/obs/cycle" element={<ObsCycle />} />
      <Route path="/obs/card" element={<ObsCard />} />
      <Route path="/admin/*" element={<AdminShell />} />
      <Route path="*" element={<MainShell />} />
    </Routes>
  );
}
