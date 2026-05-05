import { Link } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { useT } from './i18n/I18nContext.jsx';

export default function UserMenu() {
  const { user, loading, logout } = useAuth();
  const t = useT();
  if (loading) return null;
  if (!user) {
    return (
      <div className="user-menu">
        <Link to="/login">{t('user.login')}</Link>
        <Link to="/register">{t('user.register')}</Link>
      </div>
    );
  }
  return (
    <div className="user-menu">
      <span title={user.email}>{user.displayName}</span>
      <Link to="/me">{t('user.cabinet')}</Link>
      {user.role === 'admin' && <Link to="/admin/competitions">{t('user.admin')}</Link>}
      <button onClick={() => logout()}>{t('user.logout')}</button>
    </div>
  );
}
