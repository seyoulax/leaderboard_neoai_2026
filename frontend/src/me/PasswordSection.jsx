import { useState } from 'react';
import { meApi } from '../api.js';
import { useT } from '../i18n/I18nContext.jsx';

export default function PasswordSection() {
  const t = useT();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    if (form.next !== form.confirm) { setErr(t('password.mismatch')); return; }
    if (form.next.length < 8) { setErr(t('password.too_short')); return; }
    setBusy(true);
    try {
      await meApi.changePassword({ currentPassword: form.current, newPassword: form.next });
      setForm({ current: '', next: '', confirm: '' });
      setMsg(t('password.changed'));
    } catch (e) { setErr(e.message || 'failed'); }
    finally { setBusy(false); }
  }

  return (
    <section className="password-section">
      <h2>{t('password.title')}</h2>
      <form onSubmit={submit}>
        <label>{t('password.current')} <input type="password" value={form.current} onChange={set('current')} required /></label>
        <label>{t('password.new')} <input type="password" value={form.next} onChange={set('next')} required minLength={8} /></label>
        <label>{t('password.confirm')} <input type="password" value={form.confirm} onChange={set('confirm')} required /></label>
        <button disabled={busy}>{busy ? '…' : t('password.change')}</button>
        {msg && <div className="success">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </form>
    </section>
  );
}
