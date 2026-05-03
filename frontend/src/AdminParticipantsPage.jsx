import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAdminParticipants, saveAdminParticipants } from './api';

const PLACEHOLDER = `[
  {
    "id": "ivanov-ivan",
    "name": "Иванов Иван Иванович",
    "kaggleId": "ivanovii",
    "photo": "/photos/anna-smirnova.jpg",
    "role": "Участник",
    "city": "Москва",
    "grade": "10 класс",
    "achievements": [],
    "bio": ""
  }
]`;

export default function AdminParticipantsPage() {
  const { slug: competitionSlug } = useParams();
  const [text, setText] = useState('');
  const [current, setCurrent] = useState([]);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const r = await getAdminParticipants(competitionSlug);
      setCurrent(r.participants || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { refresh(); }, [competitionSlug]);

  let parsed = null;
  let parseError = null;
  if (text.trim()) {
    try {
      const v = JSON.parse(text);
      if (!Array.isArray(v)) throw new Error('не массив');
      parsed = v;
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  async function onFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const t = await file.text();
    setText(t);
  }

  async function save() {
    if (!parsed) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await saveAdminParticipants(competitionSlug, parsed);
      setInfo(`Сохранено: ${r.count}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Участники: {competitionSlug}</h2></div>

      <div className="admin-pp-upload">
        <input type="file" accept=".json,application/json" onChange={onFile} />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>или вставь JSON ниже</span>
      </div>

      <textarea
        className="admin-pp-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={20}
      />

      <div className="admin-pp-preview">
        {parseError ? <p className="status error">JSON невалиден: {parseError}</p>
          : parsed ? (
            <div>
              <p>Распознано записей: <b>{parsed.length}</b></p>
              {parsed.length > 0 ? (
                <ul>
                  {parsed.slice(0, 3).map((p, i) => (
                    <li key={i}>{p.name || p.id || '?'} — kaggleId: {p.kaggleId || '—'}</li>
                  ))}
                  {parsed.length > 3 ? <li>… и ещё {parsed.length - 3}</li> : null}
                </ul>
              ) : null}
            </div>
          ) : null}
      </div>

      <button disabled={busy || !parsed} onClick={save} className="control-btn" style={{ margin: 16 }}>
        Заменить участников
      </button>

      {error ? <p className="status error">{error}</p> : null}
      {info ? <p className="status">{info}</p> : null}

      <h3 style={{ margin: '24px 16px 8px' }}>Текущие участники: {current.length}</h3>
      <table className="admin-pp-table">
        <thead><tr><th>name</th><th>kaggleId</th></tr></thead>
        <tbody>
          {current.map((p) => (
            <tr key={p.id}>
              <td>{p.name || '—'}</td>
              <td>{p.kaggleId || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
