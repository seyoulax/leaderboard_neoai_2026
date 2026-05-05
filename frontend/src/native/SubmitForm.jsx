import { useState, useRef } from 'react';
import { submissions } from '../api.js';
import { useT } from '../i18n/I18nContext.jsx';

export default function SubmitForm({ competitionSlug, taskSlug, onSubmitted }) {
  const t = useT();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { submission } = await submissions.create(competitionSlug, taskSlug, fd);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onSubmitted?.(submission);
    } catch (e) {
      setErr(e.message || 'submit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="submit-form">
      <label className="native-field">
        <span className="native-field-label">{t('native.submit.file_label')}</span>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.json"
          onChange={(e) => setFile(e.target.files[0] || null)}
        />
      </label>
      <div className="native-edit-actions">
        <button className="control-btn" disabled={busy || !file}>
          {busy ? t('native.submit.busy') : t('native.submit.button')}
        </button>
      </div>
      {err && <p className="status error">{err}</p>}
    </form>
  );
}
