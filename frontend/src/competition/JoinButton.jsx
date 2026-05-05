import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { membership } from '../api.js';
import { useT } from '../i18n/I18nContext.jsx';

export default function JoinButton({ competitionSlug }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState({ loading: true, isMember: false });
  const t = useT();

  async function load() {
    try {
      const r = await membership.get(competitionSlug);
      setState({ loading: false, isMember: r.isMember });
    } catch (e) {
      setState({ loading: false, isMember: false });
    }
  }
  useEffect(() => { load(); }, [competitionSlug]);

  if (authLoading || state.loading) return null;
  if (!user) return <Link to="/login" className="join-link">{t('join.signin_to_join')}</Link>;
  if (state.isMember) return <span className="join-status">{t('join.is_member')}</span>;

  return (
    <button className="join-button" onClick={async () => {
      try {
        await membership.join(competitionSlug);
        await load();
      } catch (e) {
        alert(e.message || 'failed');
      }
    }}>{t('join.join')}</button>
  );
}
