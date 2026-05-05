import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AdminAuthError,
  setAdminOverallShowBonus,
  setAdminMemberBonus,
  getAdminMembersBonus,
  getCompetition,
  getOverallLeaderboard,
} from './api';

export default function AdminBonusPage() {
  const { slug: competitionSlug } = useParams();
  const navigate = useNavigate();
  const [comp, setComp] = useState(null);
  const [showBonus, setShowBonus] = useState(false);
  const [members, setMembers] = useState([]);
  const [drafts, setDrafts] = useState({}); // userId → string
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const c = await getCompetition(competitionSlug);
      setComp(c.competition);
      const lb = await getOverallLeaderboard(competitionSlug);
      setShowBonus(lb.overallShowBonusPoints === true);
      if (c.competition?.type === 'native') {
        const m = await getAdminMembersBonus(competitionSlug);
        setMembers(m.members || []);
        const d = {};
        for (const x of m.members || []) d[x.userId] = String(x.bonusPoints ?? 0);
        setDrafts(d);
      }
    } catch (e) {
      if (e instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [competitionSlug]);

  async function toggle() {
    setSaving(true);
    setError(null);
    try {
      const next = !showBonus;
      await setAdminOverallShowBonus(competitionSlug, next);
      setShowBonus(next);
      setSavedAt(new Date());
    } catch (e) {
      if (e instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveOne(userId) {
    const val = Number(drafts[userId]);
    if (!Number.isFinite(val)) {
      setError(`bonus для user#${userId} не число`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setAdminMemberBonus(competitionSlug, userId, val);
      setMembers((prev) => prev.map((m) => m.userId === userId ? { ...m, bonusPoints: val } : m));
      setSavedAt(new Date());
    } catch (e) {
      if (e instanceof AdminAuthError) navigate('/admin', { replace: true });
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="status">Загрузка...</p>;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Бонусные баллы: {competitionSlug}</h2>
        <span>{savedAt ? `сохранено ${savedAt.toLocaleTimeString()}` : ''}</span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div style={{ padding: '12px 16px' }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={showBonus} onChange={toggle} disabled={saving} />
          <span>Показывать бонусы и складывать с totalPoints на общем лидерборде</span>
        </label>
        <p className="meta" style={{ margin: '4px 0 16px' }}>
          Per-board бонусы — на странице «Лидерборды» (boards.json) есть отдельный чекбокс «бонус» на каждом борде.
        </p>
      </div>

      {comp?.type === 'native' ? (
        <div style={{ padding: '0 16px 16px' }}>
          <h3 style={{ marginTop: 0 }}>Бонусы участников (native)</h3>
          {members.length === 0 ? (
            <p className="meta">В этом соревновании пока нет участников (joined). Бонусы можно проставить после первого join'а.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Имя</th><th>Email</th><th>kaggleId</th><th>Бонус</th><th></th></tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId}>
                    <td>{m.displayName}</td>
                    <td className="mono">{m.email}</td>
                    <td className="mono">{m.kaggleId || '—'}</td>
                    <td>
                      <input
                        className="control-input"
                        style={{ width: 90 }}
                        type="number"
                        step="1"
                        value={drafts[m.userId] ?? '0'}
                        onChange={(e) => setDrafts((d) => ({ ...d, [m.userId]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <button className="control-btn" onClick={() => saveOne(m.userId)} disabled={saving}>
                        Сохранить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div style={{ padding: '0 16px 16px' }}>
          <p className="meta">
            Для kaggle-соревнования бонусы редактируются на странице{' '}
            <a href={`/admin/competitions/${competitionSlug}/participants`}>«Участники»</a> —
            числовое поле «Бонус» в каждой строке.
          </p>
        </div>
      )}
    </section>
  );
}
