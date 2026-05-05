import { NavLink } from 'react-router-dom';
import ProfileSection from './ProfileSection.jsx';
import PasswordSection from './PasswordSection.jsx';
import MyCompetitions from './MyCompetitions.jsx';
import MySubmissionsCabinet from './MySubmissionsCabinet.jsx';
import { useT } from '../i18n/I18nContext.jsx';

function MeNav() {
  const t = useT();
  return (
    <nav className="me-nav">
      <NavLink to="/me" end>{t('profile.title')}</NavLink>
      <NavLink to="/me/competitions">{t('nav.my_competitions')}</NavLink>
      <NavLink to="/me/submissions">{t('nav.my_submissions')}</NavLink>
    </nav>
  );
}

export default function MePage() {
  const t = useT();
  return (
    <div className="me-page">
      <h1>{t('me.title')}</h1>
      <MeNav />
      <ProfileSection />
      <PasswordSection />
    </div>
  );
}

export function MeCompetitionsPage() {
  const t = useT();
  return (
    <div className="me-page">
      <h1>{t('me.title.competitions')}</h1>
      <MeNav />
      <MyCompetitions />
    </div>
  );
}

export function MeSubmissionsPage() {
  const t = useT();
  return (
    <div className="me-page">
      <h1>{t('me.title.submissions')}</h1>
      <MeNav />
      <MySubmissionsCabinet />
    </div>
  );
}
