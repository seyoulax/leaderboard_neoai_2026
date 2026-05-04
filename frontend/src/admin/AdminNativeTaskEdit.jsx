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
    <section className="panel">
      <div className="panel-head">
        <h2>{competitionSlug}/{task.slug}</h2>
        <Link to={`/admin/competitions/${encodeURIComponent(competitionSlug)}/native-tasks`} className="eyebrow-link">
          ← к списку задач
        </Link>
      </div>

      <section style={{ marginBottom: 24 }}>
        <h3>Метаданные</h3>
        <label className="admin-field">
          <span className="admin-field-label">title</span>
          <input
            className="control-input"
            value={task.title}
            onChange={(e) => setTask({ ...task, title: e.target.value })}
          />
        </label>
        <label className="admin-field" style={{ marginTop: 12 }}>
          <span className="admin-field-label">description (markdown)</span>
          <MarkdownEditor value={task.descriptionMd || ''} onChange={(v) => setTask({ ...task, descriptionMd: v })} />
        </label>
        <fieldset className="admin-comp-type" style={{ marginTop: 16 }}>
          <legend>Scoring anchors</legend>
          <label>baseline pub <input type="number" step="any" value={task.baselineScorePublic ?? ''} onChange={setNum('baselineScorePublic')} /></label>
          <label>author pub <input type="number" step="any" value={task.authorScorePublic ?? ''} onChange={setNum('authorScorePublic')} /></label>
          <label>baseline priv <input type="number" step="any" value={task.baselineScorePrivate ?? ''} onChange={setNum('baselineScorePrivate')} /></label>
          <label>author priv <input type="number" step="any" value={task.authorScorePrivate ?? ''} onChange={setNum('authorScorePrivate')} /></label>
          <label><input type="checkbox" checked={!!task.higherIsBetter} onChange={(e) => setTask({ ...task, higherIsBetter: e.target.checked })} /> higherIsBetter</label>
        </fieldset>
        <button className="control-btn" disabled={savingMeta} onClick={saveMeta} style={{ marginTop: 12 }}>
          {savingMeta ? 'Сохраняем…' : 'Сохранить метаданные'}
        </button>
      </section>

      <FileSection
        title="Датасеты"
        kind="dataset"
        files={files.datasets}
        busy={busyKind === 'dataset'}
        onUpload={(f) => uploadFile('dataset', f)}
        onDelete={deleteFile}
      />
      <FileSection
        title="Стартовый набор (artifacts)"
        kind="artifact"
        files={files.artifacts}
        busy={busyKind === 'artifact'}
        onUpload={(f) => uploadFile('artifact', f)}
        onDelete={deleteFile}
      />

      <SlotSection
        title="Grader (score.py)"
        slot="grader"
        currentPath={task.graderPath}
        busy={busyKind === 'grader'}
        accept=".py"
        onUpload={(f) => uploadSlot('grader', f)}
        onDelete={() => deleteSlot('grader')}
      />
      <SlotSection
        title="Ground truth"
        slot="ground-truth"
        currentPath={task.groundTruthPath}
        busy={busyKind === 'ground-truth'}
        onUpload={(f) => uploadSlot('ground-truth', f)}
        onDelete={() => deleteSlot('ground-truth')}
      />
    </section>
  );
}

function FileSection({ title, kind, files, busy, onUpload, onDelete }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h3>{title}</h3>
      {files.length > 0 ? (
        <table className="file-table">
          <thead><tr><th>Имя</th><th>Размер</th><th></th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td>{f.displayName}{f.description ? <span className="muted"> — {f.description}</span> : null}</td>
                <td className="mono">{fmtSize(f.sizeBytes)}</td>
                <td><button onClick={() => onDelete(f.id)}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="status">Файлов нет</p>
      )}
      <p style={{ marginTop: 12 }}>
        <input
          type="file"
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(f); }}
        />
        {busy ? <span className="muted"> загружается…</span> : null}
      </p>
    </section>
  );
}

function SlotSection({ title, slot, currentPath, busy, accept, onUpload, onDelete }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h3>{title}</h3>
      <p>
        Текущий: {currentPath ? <code>{currentPath}</code> : <span className="muted">(нет)</span>}
        {currentPath ? (
          <button onClick={onDelete} style={{ marginLeft: 12 }}>🗑</button>
        ) : null}
      </p>
      <p>
        <input
          type="file"
          accept={accept}
          disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(f); }}
        />
        {busy ? <span className="muted"> загружается…</span> : null}
      </p>
    </section>
  );
}
