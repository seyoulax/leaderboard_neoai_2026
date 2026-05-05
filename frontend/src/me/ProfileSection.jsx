import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { meApi } from '../api.js';
import { useT } from '../i18n/I18nContext.jsx';

export default function ProfileSection() {
  const { user, refresh } = useAuth();
  const t = useT();
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
      setMsg(t('profile.saved'));
    } catch (e) { setErr(e.message || 'failed'); }
    finally { setBusy(false); }
  }

  if (!user) return null;
  return (
    <section className="profile-section">
      <h2>{t('profile.title')}</h2>
      <form onSubmit={save}>
        <label>{t('profile.email')} <input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>{t('profile.display_name')} <input value={form.displayName} onChange={set('displayName')} required maxLength={80} /></label>
        <label>{t('profile.kaggle_id')} <input value={form.kaggleId} onChange={set('kaggleId')} placeholder="myname" /></label>
        <button disabled={busy}>{busy ? '…' : t('common.save')}</button>
        {msg && <div className="success">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </form>
    </section>
  );
}
