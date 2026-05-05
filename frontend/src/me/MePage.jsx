import { Link } from 'react-router-dom';
import ProfileSection from './ProfileSection.jsx';
import PasswordSection from './PasswordSection.jsx';
import MyCompetitions from './MyCompetitions.jsx';
import MySubmissionsCabinet from './MySubmissionsCabinet.jsx';

export default function MePage() {
  return (
    <div className="me-page">
      <h1>Личный кабинет</h1>
      <nav className="me-nav">
        <Link to="/me">Профиль</Link>
        {' · '}
        <Link to="/me/competitions">Мои соревнования</Link>
        {' · '}
        <Link to="/me/submissions">Мои сабмиты</Link>
      </nav>
      <ProfileSection />
      <PasswordSection />
    </div>
  );
}

export function MeCompetitionsPage() {
  return (
    <div className="me-page">
      <h1>Мои соревнования</h1>
      <nav className="me-nav">
        <Link to="/me">Профиль</Link>
        {' · '}
        <Link to="/me/competitions">Мои соревнования</Link>
        {' · '}
        <Link to="/me/submissions">Мои сабмиты</Link>
      </nav>
      <MyCompetitions />
    </div>
  );
}

export function MeSubmissionsPage() {
  return (
    <div className="me-page">
      <h1>Мои сабмиты</h1>
      <nav className="me-nav">
        <Link to="/me">Профиль</Link>
        {' · '}
        <Link to="/me/competitions">Мои соревнования</Link>
        {' · '}
        <Link to="/me/submissions">Мои сабмиты</Link>
      </nav>
      <MySubmissionsCabinet />
    </div>
  );
}
