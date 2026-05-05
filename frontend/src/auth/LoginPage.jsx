import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { useT } from '../i18n/I18nContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email, password);
      nav(loc.state?.from || '/', { replace: true });
    } catch (e) { setErr(e.message || 'login failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-card">
      <h1>{t('auth.login.title')}</h1>
      <form onSubmit={submit}>
        <label>{t('auth.email')} <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>{t('auth.password')} <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <div className="error">{err}</div>}
        <button disabled={busy}>{busy ? '…' : t('auth.submit.login')}</button>
      </form>
      <p>{t('auth.no_account')} <Link to="/register">{t('auth.register.title')}</Link></p>
    </div>
  );
}
