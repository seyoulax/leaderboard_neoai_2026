import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { useT } from '../i18n/I18nContext.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const t = useT();
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
      <h1>{t('auth.register.title')}</h1>
      <form onSubmit={submit}>
        <label>{t('auth.email')} <input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>{t('auth.password_min')} <input type="password" minLength={8} value={form.password} onChange={set('password')} required /></label>
        <label>{t('auth.display_name')} <input value={form.displayName} onChange={set('displayName')} required maxLength={80} /></label>
        <label>{t('auth.kaggle_id_optional')} <input value={form.kaggleId} onChange={set('kaggleId')} placeholder="myname" /></label>
        {err && <div className="error">{err}</div>}
        <button disabled={busy}>{busy ? '…' : t('auth.submit.register')}</button>
      </form>
      <p>{t('auth.have_account')} <Link to="/login">{t('auth.login.title')}</Link></p>
    </div>
  );
}
