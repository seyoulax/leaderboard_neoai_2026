import { Link } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';

export default function UserMenu() {
  const { user, loading, logout } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <div className="user-menu">
        <Link to="/login">Войти</Link>
        <Link to="/register">Регистрация</Link>
      </div>
    );
  }
  return (
    <div className="user-menu">
      <span title={user.email}>{user.displayName}</span>
      {user.role === 'admin' && <Link to="/admin/competitions">Админка</Link>}
      <button onClick={() => logout()}>Выйти</button>
    </div>
  );
}
