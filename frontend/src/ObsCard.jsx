import { useEffect, useState } from 'react';
import { getCurrentCard } from './api';
import './obs.css';

const POLL_MS = 2000;

export default function ObsCard() {
  useEffect(() => {
    document.documentElement.classList.add('obs');
    return () => document.documentElement.classList.remove('obs');
  }, []);

  const [participant, setParticipant] = useState(null);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let active = true;

    async function fetchCard() {
      try {
        const data = await getCurrentCard();
        if (!active) return;
        setParticipant(data.current);
        setStats(data.kaggleStats);
      } catch {
        // keep last known on error
      }
    }

    fetchCard();
    const timer = setInterval(fetchCard, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!participant) return null;

  const p = participant;

  return (
    <div className="obs-root">
      <div className="obs-overlay">
        <div className="obscard" key={p.id}>
          <div className="obscard-photo-wrap">
            <img className="obscard-photo" src={p.photo} alt={p.name} />
          </div>

          <div className="obscard-name">{p.name}</div>
          <div className="obscard-role">{p.role || 'Участник'}</div>
          {p.kaggleId ? <div className="obscard-handle">@{p.kaggleId}</div> : null}

          {stats ? (
            <div className="obscard-live">
              <div className="obscard-live-cell">
                <div className="obscard-live-label">Место</div>
                <div className="obscard-live-value">#{stats.place}</div>
              </div>
              <div className="obscard-live-cell">
                <div className="obscard-live-label">Total points</div>
                <div className="obscard-live-value">{stats.totalPoints.toFixed(2)}</div>
              </div>
            </div>
          ) : null}

          <div className="obscard-divider" />

          {p.achievements && p.achievements.length > 0 ? (
            <div className="obscard-section">
              <div className="obscard-section-label">Достижения</div>
              <div className="obscard-achievements">
                {p.achievements.map((a, i) => (
                  <div key={i} className="obscard-badge">{a}</div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="obscard-fields">
            <div className="obscard-field">
              <div className="obscard-field-label">Город</div>
              <div className="obscard-field-value">{p.city || '—'}</div>
            </div>
            <div className="obscard-field">
              <div className="obscard-field-label">Класс</div>
              <div className="obscard-field-value">{p.grade || '—'}</div>
            </div>
          </div>

          {p.bio ? (
            <>
              <div className="obscard-divider" />
              <div className="obscard-section">
                <div className="obscard-section-label">О себе</div>
                <div className="obscard-bio">{p.bio}</div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
