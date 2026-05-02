import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  getOverallLeaderboard,
  getTaskLeaderboard,
  getTasks,
  getParticipants,
  getCurrentCard,
  setCurrentCard,
  getAdminToken,
  setAdminToken,
  adminPing,
  getAdminTasks,
  saveAdminTasks,
  AdminAuthError,
} from './api';
import ObsView from './ObsView';
import ObsBar from './ObsBar';
import ObsCycle from './ObsCycle';
import ObsCard from './ObsCard';

const REFRESH_MS = 30_000;

const GROUPS = {
  '1': { title: '1 тур', slugs: ['task-1', 'task-2', 'task-3'] },
  '2': { title: '2 тур', slugs: ['task-4', 'task-5', 'task-6'] },
  '3': { title: '3 тур', slugs: ['task-7', 'task-8', 'task-9'] },
};

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

function Layout({ children, tasks }) {
  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Northern Eurasia Olympiad in Artificial Intelligence 2026</p>
        <h1>NEOAI</h1>
        <p className="subtitle">Live Leaderboard · нормализация: top1 = 100, last = 0. Общий балл = сумма по всем задачам.</p>
      </header>

      <nav className="tabs">
        <NavLink to="/" end className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          Общий ЛБ
        </NavLink>
        <NavLink to="/cycle" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          По 15 (цикл)
        </NavLink>
        {Object.entries(GROUPS).map(([id, group]) => (
          <NavLink key={id} to={`/group/${id}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {group.title}
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

  if (loading) return <p className="status">Загрузка общего ЛБ...</p>;
  if (error) return <p className="status error">{error}</p>;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Общий рейтинг</h2>
        <span>Updated: {new Date(data.updatedAt).toLocaleString()}</span>
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
            {data.overall.map((row) => (
              <tr key={row.participantKey}>
                <td>{row.place}</td>
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <td className="mono">{row.totalPoints.toFixed(2)}</td>
                {data.tasks.map((task) => {
                  const points = row.tasks?.[task.slug]?.points;
                  return <td key={task.slug} className="mono">{points !== undefined ? points.toFixed(2) : '-'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CyclingOverallPage() {
  const PAGE_SIZE = 15;
  const PAGE_MS = 20_000;

  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);
  const [pageIdx, setPageIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setPageIdx((p) => p + 1), PAGE_MS);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <p className="status">Загрузка общего ЛБ...</p>;
  if (error) return <p className="status error">{error}</p>;

  const total = data.overall.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = pageIdx % totalPages;
  const start = currentPage * PAGE_SIZE;
  const slice = data.overall.slice(start, start + PAGE_SIZE);
  const endShown = Math.min(start + PAGE_SIZE, total);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Места {start + 1}–{endShown}</h2>
        <span>
          Страница {currentPage + 1} / {totalPages} · смена каждые {PAGE_MS / 1000}с · updated:{' '}
          {new Date(data.updatedAt).toLocaleString()}
        </span>
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
              <tr key={row.participantKey}>
                <td>{row.place}</td>
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <td className="mono">{row.totalPoints.toFixed(2)}</td>
                {data.tasks.map((task) => {
                  const points = row.tasks?.[task.slug]?.points;
                  return (
                    <td key={task.slug} className="mono">
                      {points !== undefined ? points.toFixed(2) : '-'}
                    </td>
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

function GroupPage() {
  const { groupId } = useParams();
  const group = GROUPS[groupId];
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);

  if (!group) return <p className="status error">Группа '{groupId}' не найдена.</p>;
  if (loading) return <p className="status">Загрузка ЛБ группы...</p>;
  if (error) return <p className="status error">{error}</p>;

  const presentSlugs = group.slugs.filter((slug) => data.tasks.some((t) => t.slug === slug));
  const groupTasks = data.tasks.filter((t) => presentSlugs.includes(t.slug));

  const ranked = data.overall
    .map((row) => {
      const total = presentSlugs.reduce((sum, slug) => sum + (row.tasks?.[slug]?.points ?? 0), 0);
      return { ...row, groupPoints: Number(total.toFixed(6)) };
    })
    .filter((row) => presentSlugs.some((slug) => row.tasks?.[slug] !== undefined))
    .sort(
      (a, b) =>
        b.groupPoints - a.groupPoints ||
        (a.nickname || a.teamName || '').localeCompare(b.nickname || b.teamName || '')
    )
    .map((row, i) => ({ ...row, place: i + 1 }));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{group.title}</h2>
        <span>Updated: {new Date(data.updatedAt).toLocaleString()}</span>
      </div>

      <ErrorBanner errors={data.errors} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nickname</th>
              <th>Team Name</th>
              <th>Group points</th>
              {groupTasks.map((task) => (
                <th key={task.slug}>{task.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <tr key={row.participantKey}>
                <td>{row.place}</td>
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <td className="mono">{row.groupPoints.toFixed(2)}</td>
                {groupTasks.map((task) => {
                  const points = row.tasks?.[task.slug]?.points;
                  return <td key={task.slug} className="mono">{points !== undefined ? points.toFixed(2) : '-'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TaskPage() {
  const { slug } = useParams();
  const { data, loading, error } = usePolling(() => getTaskLeaderboard(slug), [slug]);

  if (loading) return <p className="status">Загрузка ЛБ задачи...</p>;
  if (error) return <p className="status error">{error}</p>;

  const { task } = data;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{task.title}</h2>
        <span>Competition: {task.competition}</span>
      </div>

      <p className="meta">
        Updated: {new Date(data.updatedAt).toLocaleString()} | Metric mode: {task.higherIsBetter ? 'Higher is better' : 'Lower is better'}
      </p>

      <ErrorBanner errors={data.errors} />

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
            {task.entries.map((row) => (
              <tr key={row.participantKey}>
                <td>{row.place}</td>
                <td className="team">{row.nickname || '-'}</td>
                <td>{row.teamName || '-'}</td>
                <td className="mono">{row.rank ?? '-'}</td>
                <td className="mono">{row.score.toFixed(6)}</td>
                <td className="mono">{row.points.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ObsOverall() {
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);
  const rows = (data?.overall || []).map((r) => ({
    key: r.participantKey,
    name: r.nickname || r.teamName || '-',
    score: r.totalPoints.toFixed(2),
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

function ObsGroup() {
  const { groupId } = useParams();
  const group = GROUPS[groupId];
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);

  if (!group) {
    return <ObsView contextLabel="Группа не найдена" rows={[]} loading={false} error={`Группа '${groupId}' не найдена`} />;
  }

  const presentSlugs = (data?.tasks || [])
    .filter((t) => group.slugs.includes(t.slug))
    .map((t) => t.slug);

  const rows = (data?.overall || [])
    .map((r) => {
      const total = presentSlugs.reduce((sum, slug) => sum + (r.tasks?.[slug]?.points ?? 0), 0);
      return { ...r, groupPoints: total };
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
    }));

  return (
    <ObsView
      contextLabel={`${groupId} тур`}
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

  const task = data?.task;
  const rows = (task?.entries || []).map((r) => ({
    key: r.participantKey,
    name: r.nickname || r.teamName || '-',
    score: formatRawScore(r.score),
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

function ObsBarGroup() {
  const { groupId } = useParams();
  const group = GROUPS[groupId];
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(), []);

  if (!group) {
    return <ObsBar contextLabel="—" rows={[]} loading={false} error={`Группа '${groupId}' не найдена`} />;
  }

  const groupTasks = (data?.tasks || []).filter((t) => group.slugs.includes(t.slug));
  const presentSlugs = groupTasks.map((t) => t.slug);

  const taskLabels = groupTasks.map((t, i) => {
    const m = t.slug.match(/(\d+)/);
    const short = m ? `T${m[1]}` : `T${i + 1}`;
    return { slug: t.slug, short };
  });

  const rows = (data?.overall || [])
    .map((r) => {
      const total = presentSlugs.reduce((sum, slug) => sum + (r.tasks?.[slug]?.points ?? 0), 0);
      return { ...r, groupPoints: total };
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
      taskPoints: taskLabels.map(({ slug, short }) => ({
        slug,
        short,
        points: r.tasks?.[slug]?.points,
      })),
    }));

  return (
    <ObsBar
      contextLabel={`${groupId} тур`}
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

function MainShell() {
  const [tasks, setTasks] = useState([]);
  const [tasksError, setTasksError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await getTasks();
        if (!active) return;
        setTasks(response.tasks || []);
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
    <Layout tasks={tasks}>
      {tasksError ? <p className="status error">{tasksError}</p> : null}

      <Routes>
        <Route path="/" element={<OverallPage />} />
        <Route path="/cycle" element={<CyclingOverallPage />} />
        <Route path="/control" element={<Navigate to="/admin/card" replace />} />
        <Route path="/group/:groupId" element={<GroupPage />} />
        <Route path="/task/:slug" element={<TaskPage />} />
        <Route path="*" element={<p className="status">Страница не найдена. <Link to="/">Вернуться</Link></p>} />
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

function AdminTasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminTasks();
      const list = (data.tasks || []).map((t) => ({
        slug: t.slug || '',
        title: t.title || '',
        competition: t.competition || '',
        higherIsBetter: t.higherIsBetter !== false,
      }));
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
      { slug: '', title: '', competition: '', higherIsBetter: true },
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const data = await saveAdminTasks(tasks);
      const list = data.tasks || tasks;
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
          <span style={{ flex: '0 0 130px', textAlign: 'center' }}>higherIsBetter</span>
          <span style={{ flex: '0 0 140px' }}></span>
        </div>

        {tasks.map((task, idx) => (
          <div key={idx} className="admin-tasks-row">
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
            <label style={{ flex: '0 0 130px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={task.higherIsBetter}
                onChange={(e) => update(idx, { higherIsBetter: e.target.checked })}
              />
            </label>
            <span style={{ flex: '0 0 140px', display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button className="control-btn control-btn-ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>↑</button>
              <button className="control-btn control-btn-ghost" onClick={() => move(idx, 1)} disabled={idx === tasks.length - 1}>↓</button>
              <button className="control-btn control-btn-ghost" onClick={() => remove(idx)}>×</button>
            </span>
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
        <NavLink to="/admin/card" className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          Карточка
        </NavLink>
        <NavLink to="/" className="tab">← Лидерборд</NavLink>
        <button onClick={logout} className="tab" style={{ marginLeft: 'auto' }}>
          Выйти
        </button>
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/admin/tasks" replace />} />
          <Route path="tasks" element={<AdminTasksPage />} />
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
      <Route path="/obs/group/:groupId" element={<ObsGroup />} />
      <Route path="/obs/task/:slug" element={<ObsTask />} />
      <Route path="/obs/bar/group/:groupId" element={<ObsBarGroup />} />
      <Route path="/obs/cycle" element={<ObsCycle />} />
      <Route path="/obs/card" element={<ObsCard />} />
      <Route path="/admin/*" element={<AdminShell />} />
      <Route path="*" element={<MainShell />} />
    </Routes>
  );
}
