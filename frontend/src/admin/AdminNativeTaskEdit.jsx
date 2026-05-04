import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminNativeTasks, nativeTasks } from '../api.js';
import MarkdownEditor from '../markdown/MarkdownEditor.jsx';

function fmtSize(b) {
  if (b == null) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export default function AdminNativeTaskEdit() {
  const { competitionSlug, taskSlug } = useParams();
  const [task, setTask] = useState(null);
  const [files, setFiles] = useState({ datasets: [], artifacts: [] });
  const [error, setError] = useState(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [busyKind, setBusyKind] = useState(null);

  async function load() {
    setError(null);
    try {
      const t = await adminNativeTasks.list(competitionSlug);
      const found = (t.tasks || []).find((x) => x.slug === taskSlug);
      if (!found) {
        setError('Task not found');
        return;
      }
      setTask(found);
      const pub = await nativeTasks.getPublic(competitionSlug, taskSlug);
      setFiles({ datasets: pub.task.datasets || [], artifacts: pub.task.artifacts || [] });
    } catch (e) {
      setError(e.message || String(e));
    }
  }

  useEffect(() => { load(); }, [competitionSlug, taskSlug]);

  async function saveMeta() {
    setSavingMeta(true);
    try {
      const updated = await adminNativeTasks.update(competitionSlug, taskSlug, {
        title: task.title,
        descriptionMd: task.descriptionMd,
        higherIsBetter: task.higherIsBetter,
        baselineScorePublic: task.baselineScorePublic,
        authorScorePublic: task.authorScorePublic,
        baselineScorePrivate: task.baselineScorePrivate,
        authorScorePrivate: task.authorScorePrivate,
      });
      setTask(updated.task);
    } catch (e) {
      window.alert(`Не удалось сохранить: ${e.message || e}`);
    } finally {
      setSavingMeta(false);
    }
  }

  async function uploadFile(kind, file) {
    if (!file) return;
    setBusyKind(kind);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('display_name', file.name);
      await adminNativeTasks.uploadFile(competitionSlug, taskSlug, kind, fd);
      await load();
    } catch (e) {
      window.alert(`Загрузка failed: ${e.message || e}`);
    } finally {
      setBusyKind(null);
    }
  }

  async function deleteFile(fileId) {
    if (!window.confirm('Удалить файл?')) return;
    try {
      await adminNativeTasks.deleteFile(competitionSlug, taskSlug, fileId);
      await load();
    } catch (e) {
      window.alert(`Не удалось удалить: ${e.message || e}`);
    }
  }

  async function uploadSlot(slot, file) {
    if (!file) return;
    setBusyKind(slot);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (slot === 'grader') await adminNativeTasks.uploadGrader(competitionSlug, taskSlug, fd);
      else await adminNativeTasks.uploadGroundTruth(competitionSlug, taskSlug, fd);
      await load();
    } catch (e) {
      window.alert(`${slot} upload failed: ${e.message || e}`);
    } finally {
      setBusyKind(null);
    }
  }

  async function deleteSlot(slot) {
    if (!window.confirm(`Удалить ${slot}?`)) return;
    try {
      if (slot === 'grader') await adminNativeTasks.deleteGrader(competitionSlug, taskSlug);
      else await adminNativeTasks.deleteGroundTruth(competitionSlug, taskSlug);
      await load();
    } catch (e) {
      window.alert(`Не удалось удалить ${slot}: ${e.message || e}`);
    }
  }

  function setNum(k) {
    return (e) => {
      const v = e.target.value;
      setTask({ ...task, [k]: v === '' ? null : Number(v) });
    };
  }

  if (error) return <p className="status error">{error}</p>;
  if (!task) return <p className="status">Загрузка…</p>;

  return (
    <div className="native-edit">
      <div className="native-edit-back">
        <Link
          to={`/admin/competitions/${encodeURIComponent(competitionSlug)}/native-tasks`}
          className="eyebrow-link"
        >
          ← к списку задач
        </Link>
      </div>

      <header className="native-edit-header">
        <p className="eyebrow">{competitionSlug}</p>
        <h1>{task.title || task.slug}</h1>
        <p className="muted">slug: <code>{task.slug}</code></p>
      </header>

      <section className="panel native-edit-panel">
        <div className="panel-head"><h2>Метаданные</h2></div>
        <div className="native-edit-body">
          <label className="native-field">
            <span className="native-field-label">Название</span>
            <input
              className="control-input"
              value={task.title}
              onChange={(e) => setTask({ ...task, title: e.target.value })}
              placeholder="например: Прогноз цен на жильё"
            />
          </label>

          <label className="native-field">
            <span className="native-field-label">Описание задачи (markdown)</span>
            <MarkdownEditor value={task.descriptionMd || ''} onChange={(v) => setTask({ ...task, descriptionMd: v })} />
          </label>

          <fieldset className="native-anchors">
            <legend>Scoring anchors <span className="muted">(опц., для нормировки баллов)</span></legend>
            <div className="native-anchors-grid">
              <label className="native-anchor">
                <span>baseline pub</span>
                <input className="control-input" type="number" step="any" value={task.baselineScorePublic ?? ''} onChange={setNum('baselineScorePublic')} />
              </label>
              <label className="native-anchor">
                <span>author pub</span>
                <input className="control-input" type="number" step="any" value={task.authorScorePublic ?? ''} onChange={setNum('authorScorePublic')} />
              </label>
              <label className="native-anchor">
                <span>baseline priv</span>
                <input className="control-input" type="number" step="any" value={task.baselineScorePrivate ?? ''} onChange={setNum('baselineScorePrivate')} />
              </label>
              <label className="native-anchor">
                <span>author priv</span>
                <input className="control-input" type="number" step="any" value={task.authorScorePrivate ?? ''} onChange={setNum('authorScorePrivate')} />
              </label>
              <label className="native-anchor native-anchor-checkbox">
                <input type="checkbox" checked={!!task.higherIsBetter} onChange={(e) => setTask({ ...task, higherIsBetter: e.target.checked })} />
                <span>higher is better</span>
              </label>
            </div>
          </fieldset>

          <div className="native-edit-actions">
            <button className="control-btn" disabled={savingMeta} onClick={saveMeta}>
              {savingMeta ? 'Сохраняем…' : 'Сохранить метаданные'}
            </button>
          </div>
        </div>
      </section>

      <FileSection
        title="Датасеты"
        subtitle="данные для участников: train.csv, test.csv, и т.п."
        kind="dataset"
        files={files.datasets}
        busy={busyKind === 'dataset'}
        onUpload={(f) => uploadFile('dataset', f)}
        onDelete={deleteFile}
      />
      <FileSection
        title="Стартовый набор"
        subtitle="код-бойлерплейт: starter.ipynb, helpers.py"
        kind="artifact"
        files={files.artifacts}
        busy={busyKind === 'artifact'}
        onUpload={(f) => uploadFile('artifact', f)}
        onDelete={deleteFile}
      />

      <SlotSection
        title="Grader"
        subtitle="score.py — приватный, на проверку сабмитов (SP-3)"
        slot="grader"
        currentPath={task.graderPath}
        busy={busyKind === 'grader'}
        accept=".py"
        onUpload={(f) => uploadSlot('grader', f)}
        onDelete={() => deleteSlot('grader')}
      />
      <SlotSection
        title="Ground truth"
        subtitle="приватный — правильные ответы, читает только grader"
        slot="ground-truth"
        currentPath={task.groundTruthPath}
        busy={busyKind === 'ground-truth'}
        onUpload={(f) => uploadSlot('ground-truth', f)}
        onDelete={() => deleteSlot('ground-truth')}
      />
    </div>
  );
}

function FilePicker({ accept, busy, onChange, label }) {
  return (
    <label className={`control-btn control-btn-ghost native-file-picker ${busy ? 'busy' : ''}`}>
      {busy ? '…' : (label || '↑ Выбрать файл')}
      <input
        type="file"
        accept={accept}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onChange(f);
        }}
        style={{ display: 'none' }}
      />
    </label>
  );
}

function FileSection({ title, subtitle, kind, files, busy, onUpload, onDelete }) {
  return (
    <section className="panel native-edit-panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <div className="native-edit-body">
        {files.length > 0 ? (
          <table className="file-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th style={{ width: 140 }}>Размер</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>
                    <strong>{f.displayName}</strong>
                    {f.description ? <span className="muted"> — {f.description}</span> : null}
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{f.originalFilename}</div>
                  </td>
                  <td className="mono">{fmtSize(f.sizeBytes)}</td>
                  <td>
                    <button className="control-btn control-btn-ghost" onClick={() => onDelete(f.id)} title="удалить">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: '4px 0 16px' }}>Файлов нет — добавь первый.</p>
        )}
        <div className="native-edit-actions">
          <FilePicker
            busy={busy}
            onChange={onUpload}
            label={files.length > 0 ? '↑ Добавить ещё' : '↑ Загрузить файл'}
          />
        </div>
      </div>
    </section>
  );
}

function SlotSection({ title, subtitle, slot, currentPath, busy, accept, onUpload, onDelete }) {
  const exists = !!currentPath;
  return (
    <section className="panel native-edit-panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <div className="native-edit-body">
        <div className="native-slot-status">
          {exists ? (
            <>
              <span className="native-slot-badge native-slot-badge-on">загружен</span>
              <code className="native-slot-path" title={currentPath}>{currentPath}</code>
            </>
          ) : (
            <>
              <span className="native-slot-badge native-slot-badge-off">не загружен</span>
            </>
          )}
        </div>
        <div className="native-edit-actions">
          <FilePicker
            accept={accept}
            busy={busy}
            onChange={onUpload}
            label={exists ? '↑ Заменить' : '↑ Загрузить'}
          />
          {exists && (
            <button className="control-btn control-btn-ghost" onClick={onDelete}>Удалить</button>
          )}
        </div>
      </div>
    </section>
  );
}
