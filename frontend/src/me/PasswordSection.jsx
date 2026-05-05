import { useState } from 'react';
import { meApi } from '../api.js';

export default function PasswordSection() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    if (form.next !== form.confirm) { setErr('Пароли не совпадают'); return; }
    if (form.next.length < 8) { setErr('Новый пароль ≥ 8 символов'); return; }
    setBusy(true);
    try {
      await meApi.changePassword({ currentPassword: form.current, newPassword: form.next });
      setForm({ current: '', next: '', confirm: '' });
      setMsg('Пароль изменён');
    } catch (e) { setErr(e.message || 'failed'); }
    finally { setBusy(false); }
  }

  return (
    <section className="password-section">
      <h2>Сменить пароль</h2>
      <form onSubmit={submit}>
        <label>Текущий <input type="password" value={form.current} onChange={set('current')} required /></label>
        <label>Новый (≥ 8) <input type="password" value={form.next} onChange={set('next')} required minLength={8} /></label>
        <label>Подтверждение <input type="password" value={form.confirm} onChange={set('confirm')} required /></label>
        <button disabled={busy}>{busy ? '…' : 'Сменить'}</button>
        {msg && <div className="success">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </form>
    </section>
  );
}
