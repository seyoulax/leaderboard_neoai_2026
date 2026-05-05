import { NavLink } from 'react-router-dom';
import ProfileSection from './ProfileSection.jsx';
import PasswordSection from './PasswordSection.jsx';
import MyCompetitions from './MyCompetitions.jsx';
import MySubmissionsCabinet from './MySubmissionsCabinet.jsx';

function MeNav() {
  return (
    <nav className="me-nav">
      <NavLink to="/me" end>Профиль</NavLink>
      <NavLink to="/me/competitions">Мои соревнования</NavLink>
      <NavLink to="/me/submissions">Мои сабмиты</NavLink>
    </nav>
  );
}

export default function MePage() {
  return (
    <div className="me-page">
      <h1>Личный кабинет</h1>
      <MeNav />
      <ProfileSection />
      <PasswordSection />
    </div>
  );
}

export function MeCompetitionsPage() {
  return (
    <div className="me-page">
      <h1>Мои соревнования</h1>
      <MeNav />
      <MyCompetitions />
    </div>
  );
}

export function MeSubmissionsPage() {
  return (
    <div className="me-page">
      <h1>Мои сабмиты</h1>
      <MeNav />
      <MySubmissionsCabinet />
    </div>
  );
}
