import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { nativeTasks } from '../api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import MarkdownView from '../markdown/MarkdownView.jsx';
import NativeTaskFiles from './NativeTaskFiles.jsx';
import SubmitForm from './SubmitForm.jsx';
import MySubmissions from './MySubmissions.jsx';
import JoinButton from '../competition/JoinButton.jsx';
import { useT } from '../i18n/I18nContext.jsx';

export default function NativeTaskPage() {
  const { competitionSlug, taskSlug } = useParams();
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { user } = useAuth();
  const t = useT();

  useEffect(() => {
    setError(null);
    setTask(null);
    nativeTasks
      .getPublic(competitionSlug, taskSlug)
      .then((r) => setTask(r.task))
      .catch((e) => setError(e.message || String(e)));
  }, [competitionSlug, taskSlug]);

  if (error) return <p className="status error">{error}</p>;
  if (!task) return <p className="status">{t('common.loading')}</p>;

  return (
    <div className="page native-task">
      <header className="hero">
        <p className="eyebrow">
          <Link to={`/competitions/${competitionSlug}/leaderboard`} className="eyebrow-link">
            {t('native.back_to_comp')}
          </Link>
        </p>
        <h1>{task.title}</h1>
        <JoinButton competitionSlug={competitionSlug} />
      </header>
      <main>
        <section className="panel">
          <MarkdownView>{task.descriptionMd}</MarkdownView>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>{t('native.section.data')}</h2></div>
          <NativeTaskFiles
            files={task.datasets}
            kind="dataset"
            compSlug={competitionSlug}
            taskSlug={taskSlug}
          />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>{t('native.section.starter')}</h2></div>
          <NativeTaskFiles
            files={task.artifacts}
            kind="artifact"
            compSlug={competitionSlug}
            taskSlug={taskSlug}
          />
        </section>
        {user && (
          <section className="panel">
            <div className="panel-head"><h2>{t('native.section.submit')}</h2></div>
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
            <div className="panel-head"><h2>{t('native.section.my_subs')}</h2></div>
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
                <Link to="/login">{t('native.signin_to_submit_link')}</Link>{t('native.signin_to_submit_suffix')}
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
