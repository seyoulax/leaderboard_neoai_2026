import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { meApi } from '../api.js';

export default function ProfileSection() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({
    email: user?.email || '',
    displayName: user?.displayName || '',
    kaggleId: user?.kaggleId || '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(''); setErr('');
    try {
      await meApi.update({
        email: form.email,
        displayName: form.displayName,
        kaggleId: form.kaggleId || null,
      });
      await refresh();
      setMsg('Сохранено');
    } catch (e) { setErr(e.message || 'failed'); }
    finally { setBusy(false); }
  }

  if (!user) return null;
  return (
    <section className="profile-section">
      <h2>Профиль</h2>
      <form onSubmit={save}>
        <label>Email <input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>Имя <input value={form.displayName} onChange={set('displayName')} required maxLength={80} /></label>
        <label>Kaggle ID <input value={form.kaggleId} onChange={set('kaggleId')} placeholder="myname" /></label>
        <button disabled={busy}>{busy ? '…' : 'Сохранить'}</button>
        {msg && <div className="success">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </form>
    </section>
  );
}
