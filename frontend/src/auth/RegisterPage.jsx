import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', displayName: '', kaggleId: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await register({ ...form, kaggleId: form.kaggleId || null });
      nav('/');
    } catch (e) { setErr(e.message || 'register failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-card">
      <h1>Регистрация</h1>
      <form onSubmit={submit}>
        <label>Email <input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>Пароль (≥ 8) <input type="password" minLength={8} value={form.password} onChange={set('password')} required /></label>
        <label>Имя <input value={form.displayName} onChange={set('displayName')} required maxLength={80} /></label>
        <label>Kaggle ID (опц.) <input value={form.kaggleId} onChange={set('kaggleId')} placeholder="myname" /></label>
        {err && <div className="error">{err}</div>}
        <button disabled={busy}>{busy ? '…' : 'Создать аккаунт'}</button>
      </form>
      <p>Уже есть аккаунт? <Link to="/login">Войти</Link></p>
    </div>
  );
}
