import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdminAuthError, getAdminParticipants, saveAdminParticipants } from './api';

const FIELDS = ['id', 'name', 'kaggleId', 'photo', 'role', 'city', 'grade', 'bio'];

function normalize(list) {
  return (list || []).map((p) => {
    const out = {};
    for (const f of FIELDS) out[f] = typeof p?.[f] === 'string' ? p[f] : '';
    out.achievements = Array.isArray(p?.achievements)
      ? p.achievements.filter((a) => typeof a === 'string')
      : [];
    return out;
  });
}

function emptyParticipant() {
  return { id: '', name: '', kaggleId: '', photo: '', role: 'Участник', city: '', grade: '', achievements: [], bio: '' };
}

function slugifyName(name) {
  // Cyrillic → latin (very loose, just enough for an id seed)
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: "'", э: 'e', ю: 'ju', я: 'ja' };
  return (name || '')
    .toLowerCase()
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9'-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 2)
    .join('-');
}

export default function AdminParticipantsPage() {
  const { slug: competitionSlug } = useParams();
  const navigate = useNavigate();

  const [participants, setParticipants] = useState([]);
  const [original, setOriginal] = useState('[]');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await getAdminParticipants(competitionSlug);
      const list = normalize(r.participants);
      setParticipants(list);
      setOriginal(JSON.stringify(list));
      setExpanded(new Set());
    } catch (e) {
      if (e instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [competitionSlug]);

  function update(idx, patch) {
    setParticipants((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function move(idx, dir) {
    setParticipants((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function remove(idx) {
    const p = participants[idx];
    if (!confirm(`Удалить участника «${p.name || p.id || '—'}»?`)) return;
    setParticipants((prev) => prev.filter((_, i) => i !== idx));
    setExpanded((s) => { const n = new Set(s); n.delete(idx); return n; });
  }
  function add() {
    setParticipants((prev) => [emptyParticipant(), ...prev]);
    setExpanded((s) => {
      const shifted = new Set();
      s.forEach((i) => shifted.add(i + 1));
      shifted.add(0);
      return shifted;
    });
  }
  function toggleExpand(idx) {
    setExpanded((s) => { const n = new Set(s); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  }

  const dirty = JSON.stringify(participants) !== original;

  // --- validation ---
  const validation = useMemo(() => {
    const issues = [];
    const idCounts = new Map();
    const kaggleCounts = new Map();
    for (const p of participants) {
      const id = p.id.trim();
      const k = p.kaggleId.trim();
      if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
      if (k) kaggleCounts.set(k, (kaggleCounts.get(k) || 0) + 1);
    }
    participants.forEach((p, i) => {
      if (!p.id.trim()) issues.push({ i, msg: 'пустой id' });
      else if (idCounts.get(p.id.trim()) > 1) issues.push({ i, msg: `дубликат id: ${p.id}` });
      if (!p.kaggleId.trim()) issues.push({ i, msg: 'пустой kaggleId' });
      else if (kaggleCounts.get(p.kaggleId.trim()) > 1) issues.push({ i, msg: `дубликат kaggleId: ${p.kaggleId}` });
    });
    return issues;
  }, [participants]);

  async function save() {
    if (validation.length) {
      setError(`Не сохранено — ошибки: ${validation.length}. Поправь дубликаты/пустые id перед сохранением.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cleaned = participants.map((p) => ({
        ...p,
        id: p.id.trim(),
        name: p.name.trim(),
        kaggleId: p.kaggleId.trim(),
        photo: p.photo.trim(),
        role: p.role.trim() || 'Участник',
        city: p.city.trim(),
        grade: p.grade.trim(),
        bio: p.bio,
        achievements: p.achievements.map((a) => a.trim()).filter(Boolean),
      }));
      const r = await saveAdminParticipants(competitionSlug, cleaned);
      const list = normalize(cleaned);
      setParticipants(list);
      setOriginal(JSON.stringify(list));
      setSavedAt(new Date());
      if (r?.count != null) setSavedAt(new Date());
    } catch (e) {
      if (e instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function applyBulkReplace() {
    setError(null);
    if (!bulkText.trim()) return;
    let parsed;
    try {
      parsed = JSON.parse(bulkText);
    } catch (e) {
      setError(`JSON невалиден: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      setError('JSON должен быть массивом');
      return;
    }
    if (!confirm(`Заменить весь список (${participants.length} → ${parsed.length})? Изменения нужно будет ещё раз сохранить.`)) return;
    setParticipants(normalize(parsed));
    setExpanded(new Set());
    setBulkOpen(false);
    setBulkText('');
  }

  if (loading) return <p className="status">Загрузка участников...</p>;

  const q = filter.trim().toLowerCase();
  const visibleIdx = participants
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => {
      if (!q) return true;
      const hay = [p.id, p.name, p.kaggleId, p.city, p.grade].join(' ').toLowerCase();
      return hay.includes(q);
    });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Участники: {competitionSlug}</h2>
        <span>
          {dirty
            ? `${validation.length ? `⚠ ${validation.length} ошибок · ` : ''}есть несохранённые изменения`
            : savedAt ? `сохранено ${savedAt.toLocaleTimeString()}` : 'без изменений'}
        </span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="admin-pp-toolbar">
        <input
          className="control-input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Поиск по имени / id / городу / классу"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          {visibleIdx.length} / {participants.length}
        </span>
        <button className="control-btn control-btn-ghost" onClick={() => setBulkOpen((v) => !v)}>
          {bulkOpen ? 'Скрыть JSON' : 'JSON ↔'}
        </button>
        <button className="control-btn control-btn-ghost" onClick={add}>+ участник</button>
        <button className="control-btn control-btn-ghost" onClick={load} disabled={saving}>Откатить</button>
        <button className="control-btn" onClick={save} disabled={!dirty || saving || validation.length > 0}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>

      {bulkOpen ? (
        <div className="admin-pp-bulk">
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
            Полная замена списка. Вставь JSON-массив или загрузи файл — затем «Применить» и «Сохранить».
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input type="file" accept=".json,application/json" onChange={async (ev) => {
              const file = ev.target.files?.[0];
              if (file) setBulkText(await file.text());
            }} />
            <button className="control-btn" onClick={applyBulkReplace}>Применить</button>
            <button className="control-btn control-btn-ghost" onClick={() => { setBulkText(JSON.stringify(participants, null, 2)); }}>
              Скопировать текущий
            </button>
          </div>
          <textarea
            className="admin-pp-textarea"
            rows={10}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder='[{"id":"ivanov-ivan","name":"Иванов Иван","kaggleId":"ivanovii", ...}]'
          />
        </div>
      ) : null}

      <div className="admin-pp-list">
        {visibleIdx.length === 0 ? (
          <p className="meta" style={{ borderBottom: 0 }}>
            {participants.length === 0 ? 'Пока пусто. Нажми «+ участник».' : 'Ничего не найдено по фильтру.'}
          </p>
        ) : null}
        {visibleIdx.map(({ p, i: idx }) => {
          const isOpen = expanded.has(idx);
          const issues = validation.filter((v) => v.i === idx);
          return (
            <div key={idx} className={`admin-pp-card ${issues.length ? 'has-issue' : ''}`}>
              <div className="admin-pp-row">
                <span className="admin-pp-num muted">{idx + 1}</span>
                <input
                  className="control-input"
                  style={{ flex: '0 0 220px' }}
                  value={p.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="ФИО"
                />
                <input
                  className="control-input"
                  style={{ flex: '0 0 180px' }}
                  value={p.kaggleId}
                  onChange={(e) => update(idx, { kaggleId: e.target.value })}
                  placeholder="kaggleId"
                />
                <input
                  className="control-input"
                  style={{ flex: 1, minWidth: 120 }}
                  value={p.city}
                  onChange={(e) => update(idx, { city: e.target.value })}
                  placeholder="Город"
                />
                <input
                  className="control-input"
                  style={{ flex: '0 0 110px' }}
                  value={p.grade}
                  onChange={(e) => update(idx, { grade: e.target.value })}
                  placeholder="Класс"
                />
                <span className="admin-pp-actions">
                  <button className="control-btn control-btn-ghost" onClick={() => toggleExpand(idx)}>
                    {isOpen ? '▴' : '▾'}
                  </button>
                  <button className="control-btn control-btn-ghost" onClick={() => move(idx, -1)} disabled={idx === 0}>↑</button>
                  <button className="control-btn control-btn-ghost" onClick={() => move(idx, 1)} disabled={idx === participants.length - 1}>↓</button>
                  <button className="control-btn control-btn-ghost" onClick={() => remove(idx)}>×</button>
                </span>
              </div>

              {isOpen ? (
                <div className="admin-pp-detail">
                  <div className="admin-pp-grid">
                    <label>
                      <span>id</span>
                      <input
                        className="control-input"
                        value={p.id}
                        onChange={(e) => update(idx, { id: e.target.value })}
                        placeholder="ivanov-ivan"
                      />
                      {!p.id && p.name ? (
                        <button
                          type="button"
                          className="control-btn control-btn-ghost"
                          style={{ marginTop: 4, fontSize: 11, padding: '4px 8px' }}
                          onClick={() => update(idx, { id: slugifyName(p.name) })}
                        >
                          сгенерировать из ФИО
                        </button>
                      ) : null}
                    </label>
                    <label>
                      <span>role</span>
                      <input
                        className="control-input"
                        value={p.role}
                        onChange={(e) => update(idx, { role: e.target.value })}
                        placeholder="Участник"
                      />
                    </label>
                    <label style={{ gridColumn: '1 / -1' }}>
                      <span>photo</span>
                      <input
                        className="control-input"
                        value={p.photo}
                        onChange={(e) => update(idx, { photo: e.target.value })}
                        placeholder="/photos/ivanov-ivan.jpg"
                      />
                    </label>
                  </div>

                  <label className="admin-pp-textfield">
                    <span>achievements <span className="muted" style={{ fontSize: 11 }}>(по одному в строке, формат «Олимпиада: Результат»)</span></span>
                    <textarea
                      className="admin-pp-textarea"
                      rows={Math.max(3, p.achievements.length + 1)}
                      value={p.achievements.join('\n')}
                      onChange={(e) => update(idx, { achievements: e.target.value.split('\n') })}
                      placeholder="ВсОШ ИИ: Призёр&#10;DANO: Победитель"
                    />
                  </label>

                  <label className="admin-pp-textfield">
                    <span>bio</span>
                    <textarea
                      className="admin-pp-textarea"
                      rows={3}
                      value={p.bio}
                      onChange={(e) => update(idx, { bio: e.target.value })}
                      placeholder="Короткая биография"
                    />
                  </label>

                  {issues.length ? (
                    <ul className="admin-pp-issues">
                      {issues.map((iss, k) => <li key={k}>⚠ {iss.msg}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="meta">
        Изменения применяются после кнопки «Сохранить». Бэкенд после сохранения автоматически перезапускает обновление лидерборда.
      </p>
    </section>
  );
}
