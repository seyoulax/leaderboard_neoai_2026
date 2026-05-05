import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { nativeTasks } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import MarkdownView from '../markdown/MarkdownView.jsx';
import NativeTaskFiles from './NativeTaskFiles.jsx';
import SubmitForm from './SubmitForm.jsx';
import MySubmissions from './MySubmissions.jsx';

export default function NativeTaskPage() {
  const { competitionSlug, taskSlug } = useParams();
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    setError(null);
    setTask(null);
    nativeTasks
      .getPublic(competitionSlug, taskSlug)
      .then((r) => setTask(r.task))
      .catch((e) => setError(e.message || String(e)));
  }, [competitionSlug, taskSlug]);

  if (error) return <p className="status error">{error}</p>;
  if (!task) return <p className="status">Загрузка…</p>;

  return (
    <div className="page native-task">
      <header className="hero">
        <p className="eyebrow">
          <Link to={`/competitions/${competitionSlug}/leaderboard`} className="eyebrow-link">
            ← к соревнованию
          </Link>
        </p>
        <h1>{task.title}</h1>
      </header>
      <main>
        <section className="panel">
          <MarkdownView>{task.descriptionMd}</MarkdownView>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Данные</h2></div>
          <NativeTaskFiles
            files={task.datasets}
            kind="dataset"
            compSlug={competitionSlug}
            taskSlug={taskSlug}
          />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Стартовый набор</h2></div>
          <NativeTaskFiles
            files={task.artifacts}
            kind="artifact"
            compSlug={competitionSlug}
            taskSlug={taskSlug}
          />
        </section>
        {user && (
          <section className="panel">
            <div className="panel-head"><h2>Сдать решение</h2></div>
            <div className="native-edit-body">
              <SubmitForm
                competitionSlug={competitionSlug}
                taskSlug={taskSlug}
                onSubmitted={() => setRefreshKey((k) => k + 1)}
              />
            </div>
          </section>
        )}
        {user && (
          <section className="panel">
            <div className="panel-head"><h2>Мои сабмиты</h2></div>
            <div className="native-edit-body">
              <MySubmissions
                competitionSlug={competitionSlug}
                taskSlug={taskSlug}
                refreshKey={refreshKey}
              />
            </div>
          </section>
        )}
        {!user && (
          <section className="panel">
            <div className="native-edit-body">
              <p className="muted">
                <Link to="/login">Войди</Link>, чтобы сдать решение.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
