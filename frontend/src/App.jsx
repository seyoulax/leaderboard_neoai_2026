import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  getOverallLeaderboard,
  getTaskLeaderboard,
  getBoards,
  getParticipants,
  getCurrentCard,
  setCurrentCard,
  getCompetition,
  getAdminToken,
  setAdminToken,
  adminPing,
  getAdminTasks,
  saveAdminTasks,
  getAdminBoards,
  saveAdminBoards,
  setAdminOverallShowBonus,
  setAdminHideLeaderboards,
  setAdminOverallMultiplier,
  getCategories,
  getAdminCategories,
  saveAdminCategories,
  getAdminPrivate,
  uploadAdminPrivate,
  deleteAdminPrivate,
  getAdminPublicCsv,
  uploadAdminPublicCsv,
  deleteAdminPublicCsv,
  getAdminParticipantGroups,
  saveAdminParticipantGroups,
  setAdminCycleBoard,
  setAdminCardBoard,
  getCycleConfig,
  AdminAuthError,
} from './api';
import ObsView from './ObsView';
import ObsBar from './ObsBar';
import ObsCycle from './ObsCycle';
import ObsCard from './ObsCard';
import CompetitionsListPage from './CompetitionsListPage';
import AdminCompetitionsPage from './AdminCompetitionsPage';
import AdminParticipantsPage from './AdminParticipantsPage';
import {
  LEGACY_REDIRECTS,
  LegacyBoardRedirect,
  LegacyTaskRedirect,
  LegacyObsBoardRedirect,
  LegacyObsBoardBarRedirect,
  LegacyObsTaskRedirect,
} from './legacyRedirects';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { I18nProvider, LangToggle, useT } from './i18n/I18nContext.jsx';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import JoinButton from './competition/JoinButton.jsx';
import AdminThemePage from './AdminThemePage';
import LoginPage from './auth/LoginPage.jsx';
import NativeTaskPage from './native/NativeTaskPage.jsx';
import AdminNativeTasksList from './admin/AdminNativeTasksList.jsx';
import AdminNativeTaskEdit from './admin/AdminNativeTaskEdit.jsx';
import RegisterPage from './auth/RegisterPage.jsx';
import MePage, { MeCompetitionsPage, MeSubmissionsPage } from './me/MePage.jsx';
import UserMenu from './UserMenu.jsx';

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

function getPlaceDelta(curr, prev) {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return 0;
  return prev - curr; // positive = moved up (smaller rank number = better)
}

function PlaceDeltaTag({ delta }) {
  if (!delta) return null;
  const up = delta > 0;
  return (
    <span className={`place-delta ${up ? 'up' : 'down'}`}>
      {' '}{up ? '▲' : '▼'}{Math.abs(delta)}
    </span>
  );
}

function PlaceCell({ place, previousPlace, className = '' }) {
  return (
    <td className={className}>
      {place}
      <PlaceDeltaTag delta={getPlaceDelta(place, previousPlace)} />
    </td>
  );
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
  const t = useT();
  return (
    <button className="control-btn control-btn-ghost" onClick={onClick} title={t('lb.download.title')}>
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

function SearchBox({ value, onChange, placeholder }) {
  const t = useT();
  return (
    <input
      type="search"
      className="search-box"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? t('lb.search.placeholder')}
    />
  );
}

function matchesNickname(row, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  return (row.nickname || '').toLowerCase().includes(q);
}

function FilterToggle({ value, onChange, groups }) {
  const t = useT();
  const sortedGroups = (groups || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <select
      className="search-box filter-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={t('lb.filter.title')}
    >
      <option value="all">{t('lb.filter.all')}</option>
      <option value="ours">{t('lb.filter.ours')}</option>
      {sortedGroups.map((g) => (
        <option key={g.slug} value={`group:${g.slug}`}>{g.title}</option>
      ))}
    </select>
  );
}

function pickOverall(data, mode, filter) {
  const isPrivate = mode === 'private';
  if (filter && filter.startsWith('group:')) {
    const slug = filter.slice(6);
    const gr = (data?.groupsResults || {})[slug];
    if (!gr) return [];
    return isPrivate ? (gr.privateOverall || []) : (gr.overall || []);
  }
  if (filter === 'ours') {
    return isPrivate ? (data?.oursPrivateOverall || []) : (data?.oursOverall || []);
  }
  return isPrivate ? (data?.privateOverall || []) : (data?.overall || []);
}

function pickTaskEntries(data, mode, filter) {
  const isPrivate = mode === 'private';
  if (filter && filter.startsWith('group:')) {
    const slug = filter.slice(6);
    const map = isPrivate ? (data?.groupsPrivateTask || {}) : (data?.groupsTask || {});
    return map[slug]?.entries || [];
  }
  if (filter === 'ours') {
    return isPrivate ? (data?.oursPrivateTask?.entries || []) : (data?.oursTask?.entries || []);
  }
  return isPrivate ? (data?.privateTask?.entries || []) : (data?.task?.entries || []);
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

function themeProps(theme) {
  const style = {};
  if (theme?.accent) {
    style['--accent'] = theme.accent;
    style['--accent-soft'] = hexToRgba(theme.accent, 0.18);
    style['--accent-glow'] = hexToRgba(theme.accent, 0.5);
  }
  const preset = theme?.preset || 'default';
  const className = `theme-${preset}`;
  return { style, className };
}

function parseMultiplier(input) {
  if (input === null || input === undefined) return 1;
  const s = String(input).trim();
  if (!s) return 1;
  const m = /^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return 1;
    return num / den;
  }
  const dec = Number(s);
  return Number.isFinite(dec) ? dec : 1;
}

function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(125, 95, 255, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function Layout({ children, tasks, boards, categories, competitionSlug, competition, theme, hideLeaderboards }) {
  const t = useT();
  const isNative = competition?.type === 'native';
  const visibleBoards = sortedVisibleBoards(boards);
  const visibleCategories = (categories || [])
    .filter((c) => c.visible !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Boards that appear inside any category are reachable through the category's
  // sub-row only — drop them from the flat top row to declutter.
  const boardsInCategories = new Set(
    visibleCategories.flatMap((c) => Array.isArray(c.boardSlugs) ? c.boardSlugs : [])
  );
  const topRowBoards = visibleBoards.filter((b) => !boardsInCategories.has(b.slug));
  const virtualCat = {
    slug: '_all',
    title: 'Отдельно по задачам',
    taskSlugs: tasks.map((t) => t.slug),
    boardSlugs: [],
  };
  const allCategories = [...visibleCategories, virtualCat];

  const base = `/competitions/${encodeURIComponent(competitionSlug)}`;
  const { style, className } = themeProps(theme);

  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const isTaskPage = location.pathname.includes('/task/');
  const rawCat = searchParams.get('category');
  const selectedCatSlug = rawCat || (isTaskPage ? '_all' : null);
  const selectedCat = selectedCatSlug
    ? allCategories.find((c) => c.slug === selectedCatSlug) || null
    : null;

  function selectCategory(slug) {
    const next = new URLSearchParams(searchParams);
    if (slug == null || slug === rawCat) {
      next.delete('category');
    } else {
      next.set('category', slug);
    }
    setSearchParams(next, { replace: true });
  }

  function withCatQuery(href) {
    const sp = new URLSearchParams();
    if (selectedCatSlug) sp.set('category', selectedCatSlug);
    const qs = sp.toString();
    return qs ? `${href}?${qs}` : href;
  }

  const subTasks = selectedCat
    ? tasks.filter((t) => selectedCat.taskSlugs.includes(t.slug))
    : [];
  const subBoards = selectedCat
    ? (boards || []).filter((b) => (selectedCat.boardSlugs || []).includes(b.slug))
    : [];

  return (
    <div className={`page ${className}`} style={style}>
      <header className="hero">
        <p className="eyebrow"><Link to="/" className="eyebrow-link">{t('shell.back_to_all')}</Link></p>
        <h1>{competition?.title || 'NEOAI'}</h1>
        {competition?.subtitle ? (
          <p className="subtitle">{competition.subtitle}</p>
        ) : !isNative ? (
          <p className="subtitle">{t('shell.subtitle')}</p>
        ) : null}
        {isNative ? (
          <div style={{ marginTop: 16 }}>
            <JoinButton competitionSlug={competitionSlug} />
          </div>
        ) : null}
      </header>

      {hideLeaderboards ? null : (
        <nav className="tabs">
          <NavLink to={`${base}/leaderboard`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {t('shell.tab.overall')}
          </NavLink>
          {isNative
            ? tasks.map((task) => (
                <NavLink
                  key={task.slug}
                  to={`${base}/native-tasks/${task.slug}`}
                  className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
                >
                  {task.title}
                </NavLink>
              ))
            : null}
          {!isNative ? topRowBoards.map((board) => (
            <NavLink key={board.slug} to={`${base}/board/${board.slug}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
              {board.title}
            </NavLink>
          )) : null}
          {!isNative ? allCategories.map((cat) => (
            <button
              key={cat.slug}
              type="button"
              onClick={() => selectCategory(cat.slug)}
              className={`tab tab-cat ${selectedCatSlug === cat.slug ? 'active' : ''}`}
            >
              {cat.title}
              <span className="tab-cat-chevron" aria-hidden="true">▾</span>
            </button>
          )) : null}
        </nav>
      )}

      {selectedCat && (subTasks.length > 0 || subBoards.length > 0) ? (
        <nav className="tabs tabs-sub">
          {subBoards.map((board) => (
            <NavLink
              key={`b-${board.slug}`}
              to={withCatQuery(`${base}/board/${board.slug}`)}
              className={({ isActive }) => `tab tab-sub tab-sub-board ${isActive ? 'active' : ''}`}
            >
              {board.title}
            </NavLink>
          ))}
          {subTasks.map((task) => (
            <NavLink
              key={`t-${task.slug}`}
              to={withCatQuery(`${base}/task/${task.slug}`)}
              className={({ isActive }) => `tab tab-sub ${isActive ? 'active' : ''}`}
            >
              {task.title}
            </NavLink>
          ))}
        </nav>
      ) : null}

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
  const t = useT();
  const { competitionSlug } = useParams();
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  const [mode, setMode] = useState('public');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  if (loading) return <p className="status">Загрузка общего ЛБ...</p>;
  if (error) return <p className="status error">{error}</p>;
  if (!data?.updatedAt) return <p className="status">Бэк прогревается — идёт первое обновление с Kaggle, попробуй через минуту…</p>;
  if (data.hideLeaderboards) return <section className="panel"><div className="panel-head"><h2>Лидерборд временно скрыт</h2></div><p className="meta" style={{borderBottom:0}}>Администратор соревнования временно скрыл лидерборды.</p></section>;

  const isPrivate = mode === 'private';
  const overallSrc = pickOverall(data, mode, filter);
  const overall = (overallSrc || []).filter((r) => matchesNickname(r, query));
  const privateAvailable = (data.privateTaskSlugs || []).length > 0;

  const showBonus = data.overallShowBonusPoints === true;

  function exportCSV() {
    const headers = [
      '#', 'Nickname', 'Team Name',
      'Total points',
      ...(showBonus ? ['Tasks only'] : []),
      ...data.tasks.map((t) => t.title),
      ...(showBonus ? ['Бонус'] : []),
    ];
    const rows = overall.map((row) => [
      row.place,
      row.nickname || '',
      row.teamName || '',
      row.totalPoints.toFixed(2),
      ...(showBonus ? [(row.multipliedTasksPoints != null ? row.multipliedTasksPoints : 0).toFixed(2)] : []),
      ...data.tasks.map((t) => {
        const p = row.tasks?.[t.slug]?.points;
        return p !== undefined ? p.toFixed(2) : (isPrivate ? '0.00' : '');
      }),
      ...(showBonus ? [(row.bonusPoints || 0).toFixed(2)] : []),
    ]);
    downloadCSV(`overall${isPrivate ? '-private' : ''}.csv`, headers, rows);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('lb.title.overall')}</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <SearchBox value={query} onChange={setQuery} />
          <FilterToggle value={filter} onChange={setFilter} groups={data.groupsMeta} />
          <ModeToggle mode={mode} onChange={setMode} />
          <DownloadButton onClick={exportCSV} />
          <span>{t('lb.updated')}: {new Date(data.updatedAt).toLocaleString()}</span>
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
              <th>{t('col.nickname')}</th>
              <th>{t('col.team')}</th>
              <th>{t('col.total')}</th>
              {showBonus && <th>{t('col.tasks_only')}</th>}
              {data.tasks.map((task) => (
                <th key={task.slug}>{task.title}</th>
              ))}
              {showBonus && <th>Бонус</th>}
            </tr>
          </thead>
          <tbody>
            {overall.map((row) => (
              <tr key={row.participantKey} className={rowDirClass(getDir(row.totalPoints, row.previousTotalPoints))}>
                <PlaceCell place={row.place} previousPlace={row.previousPlace} />
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <DeltaCell value={row.totalPoints} prev={row.previousTotalPoints} />
                {showBonus && <td className="mono">{(row.multipliedTasksPoints != null ? row.multipliedTasksPoints : (row.tasksPoints != null ? row.tasksPoints : 0)).toFixed(2)}</td>}
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
                {showBonus && <td className="mono">{(row.bonusPoints || 0).toFixed(2)}</td>}
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
  const t = useT();
  const PAGE_SIZE = 15;
  const PAGE_MS = 20_000;

  const { competitionSlug } = useParams();
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  const [pageIdx, setPageIdx] = useState(0);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const timer = setInterval(() => setPageIdx((p) => p + 1), PAGE_MS);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <p className="status">Загрузка общего ЛБ...</p>;
  if (error) return <p className="status error">{error}</p>;
  if (!data?.updatedAt) return <p className="status">Бэк прогревается — идёт первое обновление с Kaggle…</p>;
  if (data.hideLeaderboards) return <section className="panel"><div className="panel-head"><h2>Лидерборд временно скрыт</h2></div><p className="meta" style={{borderBottom:0}}>Администратор соревнования временно скрыл лидерборды.</p></section>;

  const filteredOverall = pickOverall(data, 'public', filter);
  const total = filteredOverall.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = pageIdx % totalPages;
  const start = currentPage * PAGE_SIZE;
  const slice = filteredOverall.slice(start, start + PAGE_SIZE);
  const endShown = Math.min(start + PAGE_SIZE, total);

  const showBonus = data.overallShowBonusPoints === true;

  function exportCSV() {
    const headers = [
      '#', 'Nickname', 'Team Name',
      'Total points',
      ...(showBonus ? ['Tasks only'] : []),
      ...data.tasks.map((t) => t.title),
      ...(showBonus ? ['Бонус'] : []),
    ];
    const rows = filteredOverall.map((row) => [
      row.place,
      row.nickname || '',
      row.teamName || '',
      row.totalPoints.toFixed(2),
      ...(showBonus ? [(row.multipliedTasksPoints != null ? row.multipliedTasksPoints : 0).toFixed(2)] : []),
      ...data.tasks.map((t) => {
        const p = row.tasks?.[t.slug]?.points;
        return p !== undefined ? p.toFixed(2) : '';
      }),
      ...(showBonus ? [(row.bonusPoints || 0).toFixed(2)] : []),
    ]);
    downloadCSV('overall.csv', headers, rows);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Места {start + 1}–{endShown}</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <FilterToggle value={filter} onChange={setFilter} groups={data.groupsMeta} />
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
              <th>{t('col.nickname')}</th>
              <th>{t('col.team')}</th>
              <th>{t('col.total')}</th>
              {showBonus && <th>{t('col.tasks_only')}</th>}
              {data.tasks.map((task) => (
                <th key={task.slug}>{task.title}</th>
              ))}
              {showBonus && <th>Бонус</th>}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr key={row.participantKey} className={rowDirClass(getDir(row.totalPoints, row.previousTotalPoints))}>
                <PlaceCell place={row.place} previousPlace={row.previousPlace} />
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <DeltaCell value={row.totalPoints} prev={row.previousTotalPoints} />
                {showBonus && <td className="mono">{(row.multipliedTasksPoints != null ? row.multipliedTasksPoints : (row.tasksPoints != null ? row.tasksPoints : 0)).toFixed(2)}</td>}
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
                {showBonus && <td className="mono">{(row.bonusPoints || 0).toFixed(2)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BoardPage({ boards }) {
  const t = useT();
  const { competitionSlug, slug } = useParams();
  const board = (boards || []).find((b) => b.slug === slug);
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  const [mode, setMode] = useState('public');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  if (!board) return <p className="status error">Лидерборд '{slug}' не найден.</p>;
  if (loading) return <p className="status">Загрузка лидерборда...</p>;
  if (error) return <p className="status error">{error}</p>;
  if (!data?.updatedAt) return <p className="status">Бэк прогревается — идёт первое обновление с Kaggle…</p>;
  if (data.hideLeaderboards) return <section className="panel"><div className="panel-head"><h2>Лидерборд временно скрыт</h2></div><p className="meta" style={{borderBottom:0}}>Администратор соревнования временно скрыл лидерборды.</p></section>;

  const isPrivate = mode === 'private';
  const overallSrc = pickOverall(data, mode, filter);
  const privateTaskSlugs = new Set(data.privateTaskSlugs || []);
  const boardHasPrivate = board.taskSlugs.some((s) => privateTaskSlugs.has(s));

  const presentSlugs = board.taskSlugs.filter((s) => data.tasks.some((t) => t.slug === s));
  const groupTasks = data.tasks.filter((t) => presentSlugs.includes(t.slug));

  const showBonus = board.showBonusPoints === true;
  const k = parseMultiplier(board.scoreMultiplier);

  const enriched = overallSrc
    .map((row) => {
      const rawTasksSum = presentSlugs.reduce((sum, slug) => sum + (row.tasks?.[slug]?.points ?? 0), 0);
      const hasAnyPrev = presentSlugs.some((slug) => row.tasks?.[slug]?.previousPoints != null);
      const rawPrevSum = hasAnyPrev
        ? presentSlugs.reduce(
            (sum, slug) => sum + (row.tasks?.[slug]?.previousPoints ?? row.tasks?.[slug]?.points ?? 0),
            0
          )
        : null;
      const multiTasks = rawTasksSum * k;
      const multiPrev = rawPrevSum != null ? rawPrevSum * k : null;
      const bonus = Number(row.bonusPoints) || 0;
      const total = multiTasks + (showBonus ? bonus : 0);
      const prevTotal = multiPrev != null ? multiPrev + (showBonus ? bonus : 0) : null;
      return {
        ...row,
        groupPoints: Number(total.toFixed(6)),
        previousGroupPoints: prevTotal != null ? Number(prevTotal.toFixed(6)) : null,
        tasksGroupPoints: Number(multiTasks.toFixed(6)),
      };
    })
    .filter((row) => presentSlugs.some((slug) => row.tasks?.[slug] !== undefined));

  const prevPlaceMap = new Map();
  enriched
    .filter((r) => r.previousGroupPoints != null)
    .slice()
    .sort((a, b) => b.previousGroupPoints - a.previousGroupPoints
      || (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || ''))
    .forEach((r, i) => prevPlaceMap.set(r.participantKey, i + 1));

  const ranked = enriched
    .sort(
      (a, b) =>
        b.groupPoints - a.groupPoints ||
        (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
    )
    .map((row, i) => ({
      ...row,
      place: i + 1,
      previousPlace: prevPlaceMap.get(row.participantKey) ?? null,
    }));

  const visible = ranked.filter((r) => matchesNickname(r, query));

  function exportCSV() {
    const headers = [
      '#', 'Nickname', 'Team Name',
      'Board points',
      ...(showBonus ? ['Tasks only'] : []),
      ...groupTasks.map((t) => t.title),
      ...(showBonus ? ['Бонус'] : []),
    ];
    const rows = visible.map((row) => [
      row.place,
      row.nickname || '',
      row.teamName || '',
      row.groupPoints.toFixed(2),
      ...(showBonus ? [(row.tasksGroupPoints != null ? row.tasksGroupPoints : 0).toFixed(2)] : []),
      ...groupTasks.map((t) => {
        const p = row.tasks?.[t.slug]?.points;
        return p !== undefined ? p.toFixed(2) : (isPrivate ? '0.00' : '');
      }),
      ...(showBonus ? [(row.bonusPoints || 0).toFixed(2)] : []),
    ]);
    downloadCSV(`board-${board.slug}${isPrivate ? '-private' : ''}.csv`, headers, rows);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{board.title}</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <SearchBox value={query} onChange={setQuery} />
          <FilterToggle value={filter} onChange={setFilter} groups={data.groupsMeta} />
          <ModeToggle mode={mode} onChange={setMode} />
          <DownloadButton onClick={exportCSV} />
          <span>{t('lb.updated')}: {new Date(data.updatedAt).toLocaleString()}</span>
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
              <th>{t('col.nickname')}</th>
              <th>{t('col.team')}</th>
              <th>{t('col.board_total')}</th>
              {showBonus && <th>{t('col.tasks_only')}</th>}
              {groupTasks.map((task) => (
                <th key={task.slug}>{task.title}</th>
              ))}
              {showBonus && <th>Бонус</th>}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.participantKey} className={rowDirClass(getDir(row.groupPoints, row.previousGroupPoints))}>
                <PlaceCell place={row.place} previousPlace={row.previousPlace} />
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <DeltaCell value={row.groupPoints} prev={row.previousGroupPoints} />
                {showBonus && <td className="mono">{(row.tasksGroupPoints != null ? row.tasksGroupPoints : 0).toFixed(2)}</td>}
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
                {showBonus && <td className="mono">{(row.bonusPoints || 0).toFixed(2)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

function AnchorsPanel({ taskPublic, taskPrivate }) {
  const fmt = (v) => (v == null || !Number.isFinite(v)) ? '—' : Number(v).toFixed(6);
  const pub = taskPublic || {};
  const priv = taskPrivate || {};
  const bestPub = pub.entries?.[0]?.score;
  const bestPriv = priv.entries?.[0]?.score;
  const hasAny = [pub.baselineScore, pub.authorScore, bestPub, priv.baselineScore, priv.authorScore, bestPriv]
    .some((v) => v != null);
  if (!hasAny) return null;
  return (
    <div className="anchors-panel">
      <div className="anchors-grid">
        <div className="anchors-col">
          <div className="anchors-col-title">Public</div>
          <div><span className="anchors-label">baseline</span><span className="mono">{fmt(pub.baselineScore)}</span></div>
          <div><span className="anchors-label">author</span><span className="mono">{fmt(pub.authorScore)}</span></div>
          <div><span className="anchors-label">best</span><span className="mono">{fmt(bestPub)}</span></div>
        </div>
        <div className="anchors-col">
          <div className="anchors-col-title">Private</div>
          <div><span className="anchors-label">baseline</span><span className="mono">{fmt(priv.baselineScore)}</span></div>
          <div><span className="anchors-label">author</span><span className="mono">{fmt(priv.authorScore)}</span></div>
          <div><span className="anchors-label">best</span><span className="mono">{fmt(bestPriv)}</span></div>
        </div>
      </div>
    </div>
  );
}

function TaskPage() {
  const { competitionSlug, slug } = useParams();
  const { data, loading, error } = usePolling(() => getTaskLeaderboard(competitionSlug, slug), [competitionSlug, slug]);
  const [mode, setMode] = useState('public');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  if (loading) return <p className="status">Загрузка ЛБ задачи...</p>;
  if (error) return <p className="status error">{error}</p>;
  if (data?.hideLeaderboards) return <section className="panel"><div className="panel-head"><h2>Лидерборд временно скрыт</h2></div><p className="meta" style={{borderBottom:0}}>Администратор соревнования временно скрыл лидерборды.</p></section>;

  const isPrivate = mode === 'private';
  const task = isPrivate ? (data.privateTask || data.task) : data.task;
  const entriesRaw = pickTaskEntries(data, mode, filter);
  const entries = (entriesRaw || []).filter((r) => matchesNickname(r, query));
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
          <SearchBox value={query} onChange={setQuery} />
          <FilterToggle value={filter} onChange={setFilter} groups={data.groupsMeta} />
          <ModeToggle mode={mode} onChange={setMode} />
          <DownloadButton onClick={exportCSV} />
          <span>{t('lb.updated')}: {new Date(data.updatedAt).toLocaleString()}</span>
        </div>
      </div>

      <ErrorBanner errors={data.errors} />

      <AnchorsPanel taskPublic={data.task} taskPrivate={data.privateTask} />

      {isPrivate && !privateAvailable ? (
        <p className="status" style={{ margin: 24 }}>Приват ещё не посчитался — для этой задачи private CSV не загружен.</p>
      ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('col.nickname')}</th>
              <th>{t('col.team')}</th>
              <th>Kaggle Rank</th>
              <th>Raw Score</th>
              <th>NEOAI Points</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((row) => (
              <tr key={row.participantKey} className={rowDirClass(getDir(row.points, row.previousPoints))}>
                <PlaceCell place={row.place} previousPlace={row.previousPlace} />
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
  const { competitionSlug } = useParams();
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  const ours = data?.oursOverall || [];
  const sorted = ours
    .slice()
    .sort((a, b) => (b.totalPoints ?? 0) - (a.totalPoints ?? 0));
  const oursPrevPlaceMap = new Map();
  ours
    .filter((r) => Number.isFinite(r.previousTotalPoints))
    .slice()
    .sort((a, b) => b.previousTotalPoints - a.previousTotalPoints)
    .forEach((r, i) => oursPrevPlaceMap.set(r.participantKey, i + 1));
  const rows = sorted.map((r, i) => {
    const place = i + 1;
    const prevPl = oursPrevPlaceMap.get(r.participantKey);
    return {
      key: r.participantKey,
      name: r.nickname || r.teamName || '-',
      score: r.totalPoints.toFixed(2),
      dir: getDir(r.totalPoints, r.previousTotalPoints),
      placeDelta: getPlaceDelta(place, prevPl),
    };
  });
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
  const { competitionSlug, slug } = useParams();
  const boardsState = usePolling(() => getBoards(competitionSlug), [competitionSlug]);
  const board = (boardsState.data?.boards || []).find((b) => b.slug === slug);
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);

  if (!boardsState.loading && !board) {
    return <ObsView contextLabel="Лидерборд не найден" rows={[]} loading={false} error={`Лидерборд '${slug}' не найден`} />;
  }
  if (boardsState.loading) {
    return <ObsView contextLabel="Загрузка..." rows={[]} loading={true} />;
  }

  const presentSlugs = (data?.tasks || [])
    .filter((t) => board.taskSlugs.includes(t.slug))
    .map((t) => t.slug);

  const enriched = (data?.oursOverall || [])
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
    .filter((r) => presentSlugs.some((slug) => r.tasks?.[slug] !== undefined));
  const obsBoardPrevMap = new Map();
  enriched
    .filter((r) => r.previousGroupPoints != null)
    .slice()
    .sort((a, b) => b.previousGroupPoints - a.previousGroupPoints)
    .forEach((r, i) => obsBoardPrevMap.set(r.participantKey, i + 1));
  const rows = enriched
    .sort(
      (a, b) =>
        b.groupPoints - a.groupPoints ||
        (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
    )
    .map((r, i) => ({
      key: r.participantKey,
      name: r.nickname || r.teamName || '-',
      score: r.groupPoints.toFixed(2),
      dir: getDir(r.groupPoints, r.previousGroupPoints),
      placeDelta: getPlaceDelta(i + 1, obsBoardPrevMap.get(r.participantKey)),
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
  const { competitionSlug, slug } = useParams();
  const { data, loading, error } = usePolling(() => getTaskLeaderboard(competitionSlug, slug), [competitionSlug, slug]);

  const task = data?.task;
  const oursEntries = data?.oursTask?.entries || [];
  const oursTaskPrevMap = new Map();
  oursEntries
    .filter((r) => Number.isFinite(r.previousPoints))
    .slice()
    .sort((a, b) => b.previousPoints - a.previousPoints)
    .forEach((r, i) => oursTaskPrevMap.set(r.participantKey, i + 1));
  const rows = oursEntries.map((r, i) => ({
    key: r.participantKey,
    name: r.nickname || r.teamName || '-',
    score: formatRawScore(r.score),
    dir: getDir(r.points, r.previousPoints),
    placeDelta: getPlaceDelta(i + 1, oursTaskPrevMap.get(r.participantKey)),
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
  const { competitionSlug, slug } = useParams();
  const boardsState = usePolling(() => getBoards(competitionSlug), [competitionSlug]);
  const board = (boardsState.data?.boards || []).find((b) => b.slug === slug);
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);

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

  const enrichedBar = (data?.oursOverall || [])
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
    .filter((r) => presentSlugs.some((slug) => r.tasks?.[slug] !== undefined));
  const obsBarPrevMap = new Map();
  enrichedBar
    .filter((r) => r.previousGroupPoints != null)
    .slice()
    .sort((a, b) => b.previousGroupPoints - a.previousGroupPoints)
    .forEach((r, i) => obsBarPrevMap.set(r.participantKey, i + 1));
  const rows = enrichedBar
    .sort(
      (a, b) =>
        b.groupPoints - a.groupPoints ||
        (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
    )
    .map((r, i) => ({
      key: r.participantKey,
      name: r.nickname || r.teamName || '-',
      score: r.groupPoints.toFixed(2),
      dir: getDir(r.groupPoints, r.previousGroupPoints),
      placeDelta: getPlaceDelta(i + 1, obsBarPrevMap.get(r.participantKey)),
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

function CardPreview({ participant, stats }) {
  if (!participant) return null;
  const p = participant;
  const prev = stats?.previousTotalPoints;
  const dir =
    stats && prev != null && Number.isFinite(prev) && Math.abs(stats.totalPoints - prev) > 0.01
      ? stats.totalPoints > prev ? 'up' : 'down'
      : null;
  return (
    <div className="admin-card-preview">
      {p.photo ? (
        <div className="admin-card-preview-photo-wrap">
          <img className="admin-card-preview-photo" src={p.photo} alt={p.name} />
        </div>
      ) : null}
      <div className="admin-card-preview-body">
        <div className="admin-card-preview-name">{p.name}</div>
        <div className="admin-card-preview-role">{p.role || 'Участник'}</div>
        {p.kaggleId ? <div className="admin-card-preview-handle">@{p.kaggleId}</div> : null}

        {stats ? (
          <div className="admin-card-preview-live">
            <div className="admin-card-preview-cell">
              <div className="admin-card-preview-cell-label">
                Место{stats.sourceLabel ? ` (${stats.sourceLabel})` : ''}
              </div>
              <div className="admin-card-preview-cell-value">
                #{stats.place}
                {Number.isFinite(stats.previousPlace) && stats.previousPlace !== stats.place ? (
                  <span className={`place-delta ${stats.previousPlace > stats.place ? 'up' : 'down'}`}>
                    {' '}{stats.previousPlace > stats.place ? '▲' : '▼'}{Math.abs(stats.previousPlace - stats.place)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="admin-card-preview-cell">
              <div className="admin-card-preview-cell-label">
                {stats.sourceLabel && stats.sourceLabel !== 'Общий ЛБ' ? 'Board points' : 'Total points'}
              </div>
              <div className={`admin-card-preview-cell-value ${dir === 'up' ? 'cell-up' : dir === 'down' ? 'cell-down' : ''}`.trim()}>
                {stats.totalPoints.toFixed(2)}
                {dir === 'up' ? <span className="delta-arrow up"> ▲</span> : null}
                {dir === 'down' ? <span className="delta-arrow down"> ▼</span> : null}
              </div>
            </div>
          </div>
        ) : null}

        {p.achievements && p.achievements.length > 0 ? (
          <div className="admin-card-preview-section">
            <div className="admin-card-preview-section-label">Достижения</div>
            <div className="admin-card-preview-achievements">
              {p.achievements.map((a, i) => (
                <div key={i} className="admin-card-preview-badge">{a}</div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="admin-card-preview-fields">
          <div className="admin-card-preview-field">
            <div className="admin-card-preview-field-label">Город</div>
            <div className="admin-card-preview-field-value">{p.city || '—'}</div>
          </div>
          <div className="admin-card-preview-field">
            <div className="admin-card-preview-field-label">Класс</div>
            <div className="admin-card-preview-field-value">{p.grade || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlPage() {
  const { slug: competitionSlug } = useParams();
  const [list, setList] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [card, setCard] = useState(null);
  const [boards, setBoards] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const [pData, cData] = await Promise.all([
        getParticipants(competitionSlug),
        getCurrentCard(competitionSlug),
      ]);
      setList(pData.participants || []);
      setCurrentId(pData.currentId);
      setCard(cData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [competitionSlug]);

  useEffect(() => {
    let active = true;
    getBoards(competitionSlug)
      .then((r) => { if (active) setBoards(r.boards || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [competitionSlug]);

  async function pickCardBoard(slug) {
    setBusy(true);
    setError(null);
    try {
      await setAdminCardBoard(competitionSlug, slug || null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(id) {
    setBusy(true);
    setError(null);
    try {
      const data = await setCurrentCard(competitionSlug, id);
      setCurrentId(data.currentId);
      refresh();
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

        <div className="control-current">
          <span className="control-label">Источник для «Место / Total»:</span>
          <select
            className="search-box filter-select"
            value={card?.cardBoardSlug || ''}
            onChange={(e) => pickCardBoard(e.target.value)}
            disabled={busy}
          >
            <option value="">Общий ЛБ</option>
            {boards.map((b) => (
              <option key={b.slug} value={b.slug}>{b.title}</option>
            ))}
          </select>
        </div>

        {card?.current ? (
          <CardPreview participant={card.current} stats={card.kaggleStats} />
        ) : null}

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

function CompetitionShell() {
  const { competitionSlug } = useParams();
  const tasksState = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  const boardsState = usePolling(() => getBoards(competitionSlug), [competitionSlug]);
  const categoriesState = usePolling(() => getCategories(competitionSlug), [competitionSlug]);
  const [competition, setCompetition] = useState(null);

  useEffect(() => {
    let active = true;
    getCompetition(competitionSlug)
      .then((r) => { if (active) setCompetition(r.competition || null); })
      .catch(() => {});
    return () => { active = false; };
  }, [competitionSlug]);

  if (tasksState.loading || boardsState.loading || categoriesState.loading) {
    return <p className="status">Загрузка...</p>;
  }
  if (tasksState.error) {
    return <p className="status error">{tasksState.error}</p>;
  }
  return (
    <Layout
      tasks={tasksState.data?.tasks || []}
      boards={boardsState.data?.boards || []}
      categories={categoriesState.data?.categories || []}
      competitionSlug={competitionSlug}
      competition={competition}
      theme={competition?.theme || null}
      hideLeaderboards={tasksState.data?.hideLeaderboards === true}
    >
      <Outlet />
    </Layout>
  );
}

function BoardPageWrapper() {
  const { competitionSlug } = useParams();
  const { data, loading, error } = usePolling(() => getBoards(competitionSlug), [competitionSlug]);
  if (loading) return <p className="status">Загрузка...</p>;
  if (error) return <p className="status error">{error}</p>;
  return <BoardPage boards={data?.boards || []} />;
}

function AdminAuthGate() {
  const [authenticated, setAuthenticated] = useState(!!getAdminToken());
  const [checking, setChecking] = useState(!!getAdminToken());

  useEffect(() => {
    if (!getAdminToken()) {
      setChecking(false);
      return;
    }
    let active = true;
    adminPing()
      .then(() => { if (active) { setAuthenticated(true); setChecking(false); } })
      .catch(() => {
        if (!active) return;
        setAdminToken('');
        setAuthenticated(false);
        setChecking(false);
      });
    return () => { active = false; };
  }, []);

  if (checking) return <p className="status">Проверка авторизации...</p>;
  if (!authenticated) {
    return <AdminLogin onSuccess={() => setAuthenticated(true)} />;
  }

  return <Outlet />;
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

function PublicCsvRow({ slug, competitionSlug }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    if (!slug) return;
    setError(null);
    try {
      const data = await getAdminPublicCsv(competitionSlug, slug);
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
      const r = await uploadAdminPublicCsv(competitionSlug, slug, text);
      setInfo({ exists: true, count: r.count, updatedAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Удалить public CSV для ${slug}? Лидерборд снова начнёт тянуться с Kaggle.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAdminPublicCsv(competitionSlug, slug);
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
      <span className="admin-private-label">public CSV:</span>
      {info?.exists ? (
        <>
          <span className="muted">
            {info.count} строк · обновлено {new Date(info.updatedAt).toLocaleString()} · перебивает Kaggle
          </span>
          <button className="control-btn control-btn-ghost" onClick={remove} disabled={busy}>×</button>
        </>
      ) : (
        <span className="muted">не загружено · источник — Kaggle</span>
      )}
      <label className="control-btn control-btn-ghost" style={{ cursor: 'pointer' }}>
        {busy ? '...' : info?.exists ? '↑ заменить CSV' : '↑ загрузить CSV'}
        <input type="file" accept=".csv,text/csv" onChange={pick} disabled={busy} style={{ display: 'none' }} />
      </label>
      {error ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}

function PrivateRow({ slug, competitionSlug }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    if (!slug) return;
    setError(null);
    try {
      const data = await getAdminPrivate(competitionSlug, slug);
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
      const r = await uploadAdminPrivate(competitionSlug, slug, text);
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
      await deleteAdminPrivate(competitionSlug, slug);
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
  const { slug: competitionSlug } = useParams();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  function normalize(rawList) {
    return (rawList || []).map((t) => {
      const fallbackBase = t.baselineScore;
      const fallbackAuthor = t.authorScore;
      const pick = (v, fb) => {
        const x = v ?? fb;
        return x == null ? '' : String(x);
      };
      return {
        slug: t.slug || '',
        title: t.title || '',
        competition: t.competition || '',
        higherIsBetter: t.higherIsBetter !== false,
        visible: t.visible !== false,
        baselineScorePublic: pick(t.baselineScorePublic, fallbackBase),
        authorScorePublic: pick(t.authorScorePublic, fallbackAuthor),
        baselineScorePrivate: pick(t.baselineScorePrivate, fallbackBase),
        authorScorePrivate: pick(t.authorScorePrivate, fallbackAuthor),
      };
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminTasks(competitionSlug);
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
      { slug: '', title: '', competition: '', higherIsBetter: true, visible: true, baselineScorePublic: '', authorScorePublic: '', baselineScorePrivate: '', authorScorePrivate: '' },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await saveAdminTasks(competitionSlug, tasks);
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
          <span style={{ flex: '0 0 80px', textAlign: 'center' }}>visible</span>
          <span style={{ flex: '0 0 90px' }}>pub baseline</span>
          <span style={{ flex: '0 0 90px' }}>pub author</span>
          <span style={{ flex: '0 0 90px' }}>priv baseline</span>
          <span style={{ flex: '0 0 90px' }}>priv author</span>
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
              placeholder="kaggle-competition-slug (опц., если есть public CSV)"
            />
            <label style={{ flex: '0 0 110px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={task.higherIsBetter}
                onChange={(e) => update(idx, { higherIsBetter: e.target.checked })}
              />
            </label>
            <label
              style={{ flex: '0 0 80px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
              title="Когда выключено — задача скрыта от пользователей: не появляется как колонка на ЛБ, страница задачи и борды её игнорируют."
            >
              <input
                type="checkbox"
                checked={task.visible}
                onChange={(e) => update(idx, { visible: e.target.checked })}
              />
            </label>
            <input
              className="control-input"
              style={{ flex: '0 0 90px' }}
              type="number"
              step="any"
              value={task.baselineScorePublic}
              onChange={(e) => update(idx, { baselineScorePublic: e.target.value })}
              placeholder=""
            />
            <input
              className="control-input"
              style={{ flex: '0 0 90px' }}
              type="number"
              step="any"
              value={task.authorScorePublic}
              onChange={(e) => update(idx, { authorScorePublic: e.target.value })}
              placeholder=""
            />
            <input
              className="control-input"
              style={{ flex: '0 0 90px' }}
              type="number"
              step="any"
              value={task.baselineScorePrivate}
              onChange={(e) => update(idx, { baselineScorePrivate: e.target.value })}
              placeholder=""
            />
            <input
              className="control-input"
              style={{ flex: '0 0 90px' }}
              type="number"
              step="any"
              value={task.authorScorePrivate}
              onChange={(e) => update(idx, { authorScorePrivate: e.target.value })}
              placeholder=""
            />
            <span style={{ flex: '0 0 140px', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button className="control-btn control-btn-ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>↑</button>
              <button className="control-btn control-btn-ghost" onClick={() => move(idx, 1)} disabled={idx === tasks.length - 1}>↓</button>
              <button className="control-btn control-btn-ghost" onClick={() => remove(idx)}>×</button>
            </span>
          </div>
          <PublicCsvRow slug={task.slug} competitionSlug={competitionSlug} />
          <PrivateRow slug={task.slug} competitionSlug={competitionSlug} />
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
  const { slug: competitionSlug } = useParams();
  const navigate = useNavigate();
  const [boards, setBoards] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [overallShowBonus, setOverallShowBonus] = useState(false);
  const [overallToggleSaving, setOverallToggleSaving] = useState(false);
  const [hideLeaderboards, setHideLeaderboards] = useState(false);
  const [hideToggleSaving, setHideToggleSaving] = useState(false);
  const [overallMultiplier, setOverallMultiplier] = useState('');
  const [overallMultiplierOriginal, setOverallMultiplierOriginal] = useState('');
  const [overallMultiplierSaving, setOverallMultiplierSaving] = useState(false);

  function normalize(rawList, knownSet) {
    return (rawList || []).map((b) => ({
      slug: b.slug || '',
      title: b.title || '',
      taskSlugs: Array.isArray(b.taskSlugs)
        ? b.taskSlugs.filter((s) => !knownSet || knownSet.has(s))
        : [],
      visible: b.visible !== false,
      order: b.order ?? 0,
      showBonusPoints: b.showBonusPoints === true,
      scoreMultiplier: typeof b.scoreMultiplier === 'string' ? b.scoreMultiplier : '',
    }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [b, t, lb] = await Promise.all([
        getAdminBoards(competitionSlug),
        getAdminTasks(competitionSlug),
        getOverallLeaderboard(competitionSlug).catch(() => ({})),
      ]);
      const tasksList = t.tasks || [];
      const known = new Set(tasksList.map((x) => x.slug));
      const list = normalize(b.boards, known);
      setBoards(list);
      setAllTasks(tasksList);
      setOriginal(JSON.stringify(list));
      setOverallShowBonus(lb?.overallShowBonusPoints === true);
      setHideLeaderboards(lb?.hideLeaderboards === true);
      const mul = typeof lb?.overallScoreMultiplier === 'string' ? lb.overallScoreMultiplier : '';
      setOverallMultiplier(mul);
      setOverallMultiplierOriginal(mul);
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

  async function toggleOverallBonus(next) {
    setOverallToggleSaving(true);
    setError(null);
    try {
      await setAdminOverallShowBonus(competitionSlug, next);
      setOverallShowBonus(next);
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOverallToggleSaving(false);
    }
  }

  async function saveOverallMultiplier() {
    setOverallMultiplierSaving(true);
    setError(null);
    try {
      const r = await setAdminOverallMultiplier(competitionSlug, overallMultiplier || '');
      const m = typeof r?.overallScoreMultiplier === 'string' ? r.overallScoreMultiplier : (overallMultiplier || '');
      setOverallMultiplier(m);
      setOverallMultiplierOriginal(m);
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOverallMultiplierSaving(false);
    }
  }

  async function toggleHideLeaderboards(next) {
    setHideToggleSaving(true);
    setError(null);
    try {
      await setAdminHideLeaderboards(competitionSlug, next);
      setHideLeaderboards(next);
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setHideToggleSaving(false);
    }
  }

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
      { slug: '', title: '', taskSlugs: [], visible: true, order: nextOrder, showBonusPoints: false, scoreMultiplier: '' },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await saveAdminBoards(competitionSlug, boards);
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

      <div className="admin-bonus-toggle">
        <label>
          <input
            type="checkbox"
            checked={overallShowBonus}
            onChange={(e) => toggleOverallBonus(e.target.checked)}
            disabled={overallToggleSaving}
          />
          <span>Показывать бонусы и складывать с totalPoints на общем лидерборде</span>
        </label>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          Per-board бонусы — чекбокс «бонус» в каждой карточке ниже.
        </p>
      </div>

      <div className="admin-bonus-toggle">
        <label>
          <input
            type="checkbox"
            checked={hideLeaderboards}
            onChange={(e) => toggleHideLeaderboards(e.target.checked)}
            disabled={hideToggleSaving}
          />
          <span>Скрыть все лидерборды и страницы задач от пользователей</span>
        </label>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          Когда включено — на публичных страницах вместо таблиц показывается заглушка
          «Лидерборд временно скрыт». Табы лидербордов скрываются, страницы задач
          (native description + submit) тоже становятся недоступны.
        </p>
      </div>

      <div className="admin-bonus-toggle">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Коэффициент общего ЛБ:</span>
            <input
              className="control-input"
              style={{ width: 110, padding: '6px 10px' }}
              value={overallMultiplier}
              onChange={(e) => setOverallMultiplier(e.target.value)}
              placeholder="напр. 2/3 или 0.75"
            />
          </label>
          <button
            className="control-btn"
            onClick={saveOverallMultiplier}
            disabled={overallMultiplierSaving || overallMultiplier === overallMultiplierOriginal}
          >
            {overallMultiplierSaving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
          Дробь («2/3») или десятичное («0.75»). Пусто = ×1. Применяется к сумме баллов
          за задачи (бонусы НЕ умножаются). Total = tasks × k + bonus (если бонусы включены).
        </p>
      </div>

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
              <label className="admin-field admin-field-check">
                <span className="admin-field-label">бонус</span>
                <input
                  type="checkbox"
                  checked={board.showBonusPoints}
                  onChange={(e) => update(idx, { showBonusPoints: e.target.checked })}
                />
              </label>
              <label className="admin-field" style={{ flex: '0 0 110px' }}>
                <span className="admin-field-label">коэф.</span>
                <input
                  className="control-input"
                  value={board.scoreMultiplier || ''}
                  onChange={(e) => update(idx, { scoreMultiplier: e.target.value })}
                  placeholder="2/3"
                  title="Коэффициент для баллов задач этого борда. Дробь («2/3») или число («0.75»). Пусто = ×1."
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

function AdminCategoriesPage() {
  const { slug: competitionSlug } = useParams();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [allBoards, setAllBoards] = useState([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  function normalize(rawList, knownTasks, knownBoards) {
    return (rawList || []).map((c) => ({
      slug: c.slug || '',
      title: c.title || '',
      taskSlugs: Array.isArray(c.taskSlugs)
        ? c.taskSlugs.filter((s) => !knownTasks || knownTasks.has(s))
        : [],
      boardSlugs: Array.isArray(c.boardSlugs)
        ? c.boardSlugs.filter((s) => !knownBoards || knownBoards.has(s))
        : [],
      visible: c.visible !== false,
      order: c.order ?? 0,
    }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [c, t, b] = await Promise.all([
        getAdminCategories(competitionSlug),
        getAdminTasks(competitionSlug),
        getAdminBoards(competitionSlug),
      ]);
      const tasksList = t.tasks || [];
      const boardsList = b.boards || [];
      const knownTasks = new Set(tasksList.map((x) => x.slug));
      const knownBoards = new Set(boardsList.map((x) => x.slug));
      const list = normalize(c.categories, knownTasks, knownBoards);
      setCategories(list);
      setAllTasks(tasksList);
      setAllBoards(boardsList);
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
    setCategories((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function toggleTask(idx, slug) {
    setCategories((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const has = c.taskSlugs.includes(slug);
        return {
          ...c,
          taskSlugs: has ? c.taskSlugs.filter((s) => s !== slug) : [...c.taskSlugs, slug],
        };
      })
    );
  }

  function toggleBoard(idx, slug) {
    setCategories((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const has = c.boardSlugs.includes(slug);
        return {
          ...c,
          boardSlugs: has ? c.boardSlugs.filter((s) => s !== slug) : [...c.boardSlugs, slug],
        };
      })
    );
  }

  function remove(idx) {
    if (!confirm('Удалить категорию?')) return;
    setCategories((prev) => prev.filter((_, i) => i !== idx));
  }

  function add() {
    const nextOrder = categories.reduce((m, c) => Math.max(m, c.order ?? 0), 0) + 1;
    setCategories((prev) => [
      ...prev,
      { slug: '', title: '', taskSlugs: [], boardSlugs: [], visible: true, order: nextOrder },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await saveAdminCategories(competitionSlug, categories);
      const knownTasks = new Set(allTasks.map((x) => x.slug));
      const knownBoards = new Set(allBoards.map((x) => x.slug));
      const list = normalize(data.categories, knownTasks, knownBoards);
      setCategories(list);
      setOriginal(JSON.stringify(list));
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(categories) !== original;

  if (loading) return <p className="status">Загрузка категорий...</p>;

  const sorted = categories
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.order ?? 0) - (b.c.order ?? 0));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Категории задач (categories.json)</h2>
        <span>
          {dirty ? 'есть несохранённые изменения' : savedAt ? `сохранено ${savedAt.toLocaleTimeString()}` : 'без изменений'}
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="admin-boards">
        {sorted.length === 0 ? (
          <p className="meta">Пока ни одной категории. Категория «Отдельно по задачам» (со всеми задачами) показывается автоматически.</p>
        ) : null}

        {sorted.map(({ c: cat, i: idx }) => (
          <div key={idx} className="admin-board-card">
            <div className="admin-board-row">
              <label className="admin-field">
                <span className="admin-field-label">slug</span>
                <input
                  className="control-input"
                  value={cat.slug}
                  onChange={(e) => update(idx, { slug: e.target.value })}
                  placeholder="day-1"
                />
              </label>
              <label className="admin-field" style={{ flex: 1 }}>
                <span className="admin-field-label">название</span>
                <input
                  className="control-input"
                  value={cat.title}
                  onChange={(e) => update(idx, { title: e.target.value })}
                  placeholder="Day 1"
                />
              </label>
              <label className="admin-field" style={{ flex: '0 0 90px' }}>
                <span className="admin-field-label">order</span>
                <input
                  className="control-input"
                  type="number"
                  value={cat.order}
                  onChange={(e) => update(idx, { order: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="admin-field admin-field-check">
                <span className="admin-field-label">visible</span>
                <input
                  type="checkbox"
                  checked={cat.visible}
                  onChange={(e) => update(idx, { visible: e.target.checked })}
                />
              </label>
              <button className="control-btn control-btn-ghost" onClick={() => remove(idx)}>×</button>
            </div>

            <div className="admin-board-tasks">
              <div className="admin-field-label">лидерборды (boards) в категории</div>
              <div className="admin-board-tasks-list">
                {allBoards.length === 0 ? (
                  <span className="meta">Нет лидербордов — создай их во вкладке «Boards»</span>
                ) : (
                  allBoards.map((b) => (
                    <label key={b.slug} className="admin-board-task-pick">
                      <input
                        type="checkbox"
                        checked={cat.boardSlugs.includes(b.slug)}
                        onChange={() => toggleBoard(idx, b.slug)}
                      />
                      <span>{b.title}</span>
                      <span className="muted"> ({b.slug})</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="admin-board-tasks">
              <div className="admin-field-label">задачи в категории</div>
              <div className="admin-board-tasks-list">
                {allTasks.length === 0 ? (
                  <span className="meta">Нет задач — создай их во вкладке «Задачи»</span>
                ) : (
                  allTasks.map((t) => (
                    <label key={t.slug} className="admin-board-task-pick">
                      <input
                        type="checkbox"
                        checked={cat.taskSlugs.includes(t.slug)}
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
          <button className="control-btn control-btn-ghost" onClick={add}>+ категория</button>
          <button className="control-btn control-btn-ghost" onClick={load} disabled={saving}>Откатить</button>
          <button className="control-btn" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>

        <p className="meta">
          Категории показываются в шапке публичного лидерборда — клик раскрывает вторую строку
          с задачами категории. Категория «Отдельно по задачам» (со всеми задачами) добавляется
          автоматически и не редактируется. Slug <code>_all</code> зарезервирован.
        </p>
      </div>
    </section>
  );
}

function AdminParticipantGroupsPage() {
  const { slug: competitionSlug } = useParams();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  function normalize(rawList) {
    return (rawList || []).map((g) => ({
      slug: g.slug || '',
      title: g.title || '',
      kaggleIds: Array.isArray(g.kaggleIds) ? g.kaggleIds : [],
      kaggleIdsText: (Array.isArray(g.kaggleIds) ? g.kaggleIds : []).join('\n'),
      order: g.order ?? 0,
    }));
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await getAdminParticipantGroups(competitionSlug);
      const list = normalize(r.groups);
      setGroups(list);
      setOriginal(JSON.stringify(list.map((g) => ({ ...g, kaggleIdsText: undefined }))));
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
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
  }

  function updateIds(idx, text) {
    const ids = text
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    update(idx, { kaggleIdsText: text, kaggleIds: ids });
  }

  function remove(idx) {
    if (!confirm('Удалить группу?')) return;
    setGroups((prev) => prev.filter((_, i) => i !== idx));
  }

  function add() {
    const nextOrder = groups.reduce((m, g) => Math.max(m, g.order ?? 0), 0) + 1;
    setGroups((prev) => [
      ...prev,
      { slug: '', title: '', kaggleIds: [], kaggleIdsText: '', order: nextOrder },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = groups.map((g) => ({
        slug: g.slug,
        title: g.title,
        kaggleIds: g.kaggleIds,
        order: g.order,
      }));
      const r = await saveAdminParticipantGroups(competitionSlug, payload);
      const list = normalize(r.groups);
      setGroups(list);
      setOriginal(JSON.stringify(list.map((g) => ({ ...g, kaggleIdsText: undefined }))));
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = JSON.stringify(groups.map((g) => ({ ...g, kaggleIdsText: undefined }))) !== original;

  if (loading) return <p className="status">Загрузка групп...</p>;

  const sorted = groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (a.g.order ?? 0) - (b.g.order ?? 0));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Группы участников (participant-groups.json)</h2>
        <span>
          {dirty ? 'есть несохранённые изменения' : savedAt ? `сохранено ${savedAt.toLocaleTimeString()}` : 'без изменений'}
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="admin-boards">
        {sorted.length === 0 ? (
          <p className="meta">Пока ни одной группы. На публичных лидербордах появятся как опции рядом с «Все / Только наши».</p>
        ) : null}

        {sorted.map(({ g: group, i: idx }) => (
          <div key={idx} className="admin-board-card">
            <div className="admin-board-row">
              <label className="admin-field">
                <span className="admin-field-label">slug</span>
                <input
                  className="control-input"
                  value={group.slug}
                  onChange={(e) => update(idx, { slug: e.target.value })}
                  placeholder="kyrgyzstan"
                />
              </label>
              <label className="admin-field" style={{ flex: 1 }}>
                <span className="admin-field-label">название</span>
                <input
                  className="control-input"
                  value={group.title}
                  onChange={(e) => update(idx, { title: e.target.value })}
                  placeholder="Kyrgyzstan"
                />
              </label>
              <label className="admin-field" style={{ flex: '0 0 90px' }}>
                <span className="admin-field-label">order</span>
                <input
                  className="control-input"
                  type="number"
                  value={group.order}
                  onChange={(e) => update(idx, { order: Number(e.target.value) || 0 })}
                />
              </label>
              <button className="control-btn control-btn-ghost" onClick={() => remove(idx)}>×</button>
            </div>

            <div className="admin-board-tasks">
              <div className="admin-field-label">
                kaggle ники участников ({group.kaggleIds.length}) — через пробел, запятую или с новой строки
              </div>
              <textarea
                className="control-input"
                style={{ minHeight: 96, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                value={group.kaggleIdsText}
                onChange={(e) => updateIds(idx, e.target.value)}
                placeholder="ianbobrus&#10;bars301109&#10;sabyralymbekov"
              />
            </div>
          </div>
        ))}

        <div className="admin-tasks-actions">
          <button className="control-btn control-btn-ghost" onClick={add}>+ группа</button>
          <button className="control-btn control-btn-ghost" onClick={load} disabled={saving}>Откатить</button>
          <button className="control-btn" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>

        <p className="meta">
          После сохранения бэк пересчитывает per-group лидерборды (нормировка/якоря применяются на
          подсете — место и очки внутри группы пересчитываются). Slug-и <code>all</code>, <code>ours</code> зарезервированы.
        </p>
      </div>
    </section>
  );
}

function AdminCyclePage() {
  const { slug: competitionSlug } = useParams();
  const navigate = useNavigate();
  const [boards, setBoards] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [b, c] = await Promise.all([
        getAdminBoards(competitionSlug),
        getCycleConfig(competitionSlug),
      ]);
      const list = (b.boards || []).slice().sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
      setBoards(list);
      setCurrent(c.cycleBoardSlug || null);
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [competitionSlug]);

  async function pick(slug) {
    setBusy(true);
    setError(null);
    try {
      const r = await setAdminCycleBoard(competitionSlug, slug);
      setCurrent(r.cycleBoardSlug || null);
      setSavedAt(new Date());
    } catch (err) {
      if (err instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="status">Загрузка...</p>;

  const obsUrl = `/obs/competitions/${encodeURIComponent(competitionSlug)}/cycle`;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>OBS Cycle — какой ЛБ показывать</h2>
        <span>
          OBS: <code>{obsUrl}</code>
          {savedAt ? ` · сохранено ${savedAt.toLocaleTimeString()}` : ''}
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="control-body">
        <div className="control-list">
          <button
            disabled={busy}
            onClick={() => pick(null)}
            className={`control-item ${current === null ? 'active' : ''}`}
          >
            <span className="control-item-name">Общий лидерборд</span>
            <span className="control-item-id">все задачи</span>
            {current === null ? <span className="control-item-badge">в эфире</span> : null}
          </button>

          {boards.length === 0 ? (
            <p className="meta">Нет других лидербордов — создай их во вкладке «Boards».</p>
          ) : (
            boards.map((b) => {
              const active = current === b.slug;
              return (
                <button
                  key={b.slug}
                  disabled={busy}
                  onClick={() => pick(b.slug)}
                  className={`control-item ${active ? 'active' : ''}`}
                >
                  <span className="control-item-name">{b.title}</span>
                  <span className="control-item-id">
                    {b.taskSlugs.length} задач
                    {b.visible === false ? ' · скрыт в навигации' : ''}
                  </span>
                  {active ? <span className="control-item-badge">в эфире</span> : null}
                </button>
              );
            })
          )}
        </div>

        <p className="meta">
          OBS-страница <code>/obs/.../cycle</code> опрашивает выбор каждые 5с и сама
          переключится на нужный лидерборд (с фильтром «только наши»).
        </p>
      </div>
    </section>
  );
}

function AdminShell() {
  const { slug: competitionSlug } = useParams();
  const base = competitionSlug ? `/admin/competitions/${encodeURIComponent(competitionSlug)}` : '';
  return (
    <div className="admin-page">
      <header className="hero">
        <h1>NEOAI Admin</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Link to="/admin/competitions" className="eyebrow-link">← все соревнования</Link>
          <Link to="/admin/theme" className="eyebrow-link">тема (глобально)</Link>
        </div>
      </header>
      {competitionSlug ? (
        <nav className="tabs">
          <NavLink to={`${base}/tasks`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Tasks</NavLink>
          <NavLink to={`${base}/boards`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Boards</NavLink>
          <NavLink to={`${base}/categories`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Categories</NavLink>
          <NavLink to={`${base}/participants`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Participants</NavLink>
          <NavLink to={`${base}/groups`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Groups</NavLink>
          <NavLink to={`${base}/card`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Card</NavLink>
          <NavLink to={`${base}/cycle`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Cycle</NavLink>
        </nav>
      ) : null}
      <Outlet />
    </div>
  );
}

function SiteHeader() {
  const { user } = useAuth();
  const t = useT();
  const location = useLocation();
  if (location.pathname.startsWith('/obs/')) return null;
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="site-header-brand" title="StackMoreLayers — сделано Данисом · github.com/seyoulax">
          <svg className="site-header-logo" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%"  stopColor="#a48bff"/>
                <stop offset="100%" stopColor="#7d5fff"/>
              </linearGradient>
            </defs>
            <rect x="3"  y="14.5" width="18" height="4" rx="1.5" fill="url(#brand-grad)" opacity="0.5"/>
            <rect x="5"  y="9.25" width="14" height="4" rx="1.5" fill="url(#brand-grad)" opacity="0.78"/>
            <rect x="7"  y="4"    width="10" height="4" rx="1.5" fill="url(#brand-grad)"/>
          </svg>
          <span className="site-header-brand-text">StackMoreLayers</span>
        </Link>
        <nav className="site-header-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `site-header-link ${isActive ? 'active' : ''}`}
          >
            {t('nav.competitions')}
          </NavLink>
          {user ? (
            <>
              <NavLink
                to="/me"
                end
                className={({ isActive }) => `site-header-link ${isActive ? 'active' : ''}`}
              >
                {t('nav.cabinet')}
              </NavLink>
              <NavLink
                to="/me/competitions"
                className={({ isActive }) => `site-header-link ${isActive ? 'active' : ''}`}
              >
                {t('nav.my_competitions')}
              </NavLink>
              <NavLink
                to="/me/submissions"
                className={({ isActive }) => `site-header-link ${isActive ? 'active' : ''}`}
              >
                {t('nav.my_submissions')}
              </NavLink>
            </>
          ) : null}
        </nav>
        <LangToggle />
        <UserMenu />
      </div>
    </header>
  );
}

export default function App() {
  return (
    <I18nProvider>
    <ThemeProvider>
    <AuthProvider>
      <SiteHeader />
      <Routes>
      {/* Public root: list of competitions */}
      <Route path="/" element={<CompetitionsListPage />} />
      <Route path="/competitions" element={<CompetitionsListPage />} />

      {/* Auth */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/me" element={<MePage />} />
      <Route path="/me/competitions" element={<MeCompetitionsPage />} />
      <Route path="/me/submissions" element={<MeSubmissionsPage />} />

      {/* Native task public page (outside CompetitionShell — own header + nav) */}
      <Route path="/competitions/:competitionSlug/native-tasks/:taskSlug" element={<NativeTaskPage />} />

      {/* Public per-competition routes */}
      <Route path="/competitions/:competitionSlug" element={<CompetitionShell />}>
        <Route index element={<Navigate to="leaderboard" replace />} />
        <Route path="leaderboard" element={<OverallPage />} />
        <Route path="cycle" element={<CyclingOverallPage />} />
        <Route path="board/:slug" element={<BoardPageWrapper />} />
        <Route path="task/:slug" element={<TaskPage />} />
      </Route>

      {/* Admin */}
      <Route path="/admin" element={<AdminAuthGate />}>
        <Route index element={<Navigate to="competitions" replace />} />
        <Route path="competitions" element={<AdminCompetitionsPage />} />
        <Route path="theme" element={<AdminThemePage />} />
        <Route path="competitions/:slug" element={<AdminShell />}>
          <Route index element={<Navigate to="tasks" replace />} />
          <Route path="tasks" element={<AdminTasksPage />} />
          <Route path="boards" element={<AdminBoardsPage />} />
          <Route path="categories" element={<AdminCategoriesPage />} />
          <Route path="participants" element={<AdminParticipantsPage />} />
          <Route path="groups" element={<AdminParticipantGroupsPage />} />
          <Route path="card" element={<ControlPage />} />
          <Route path="cycle" element={<AdminCyclePage />} />
        </Route>
        <Route path="competitions/:competitionSlug/native-tasks" element={<AdminNativeTasksList />} />
        <Route path="competitions/:competitionSlug/native-tasks/:taskSlug" element={<AdminNativeTaskEdit />} />
      </Route>

      {/* OBS (no header/nav) */}
      <Route path="/obs/competitions/:competitionSlug/overall" element={<ObsOverall />} />
      <Route path="/obs/competitions/:competitionSlug/cycle" element={<ObsCycle />} />
      <Route path="/obs/competitions/:competitionSlug/board/:slug" element={<ObsBoard />} />
      <Route path="/obs/competitions/:competitionSlug/bar/board/:slug" element={<ObsBoardBar />} />
      <Route path="/obs/competitions/:competitionSlug/task/:slug" element={<ObsTask />} />
      <Route path="/obs/competitions/:competitionSlug/card" element={<ObsCard />} />

      {/* Legacy URL redirects */}
      {LEGACY_REDIRECTS.map((r) => (
        <Route key={r.from} path={r.from} element={<Navigate to={r.to} replace />} />
      ))}
      <Route path="/board/:slug" element={<LegacyBoardRedirect />} />
      <Route path="/task/:slug" element={<LegacyTaskRedirect />} />
      <Route path="/obs/board/:slug" element={<LegacyObsBoardRedirect />} />
      <Route path="/obs/bar/board/:slug" element={<LegacyObsBoardBarRedirect />} />
      <Route path="/obs/task/:slug" element={<LegacyObsTaskRedirect />} />

      {/* 404 */}
      <Route path="*" element={
        <p className="status" style={{ padding: 24 }}>
          Страница не найдена. <Link to="/">На главную</Link>
        </p>
      } />
      </Routes>
      <SiteFooter />
    </AuthProvider>
    </ThemeProvider>
    </I18nProvider>
  );
}

function SiteFooter() {
  const t = useT();
  const location = useLocation();
  if (location.pathname.startsWith('/obs/')) return null;
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>
          {t('footer.made_by')} <strong>Danis</strong> ·{' '}
          <a href="https://github.com/seyoulax" target="_blank" rel="noreferrer">github.com/seyoulax</a>
          {' '}· {new Date().getFullYear()}
        </span>
      </div>
    </footer>
  );
}
