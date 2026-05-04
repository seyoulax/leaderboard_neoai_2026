import { useState } from 'react';
import MarkdownView from './MarkdownView.jsx';

export default function MarkdownEditor({ value, onChange }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="md-editor">
      <div className="md-editor-toolbar">
        <button type="button" onClick={() => setPreview(false)} disabled={!preview} className="control-btn control-btn-ghost">Edit</button>
        <button type="button" onClick={() => setPreview(true)} disabled={preview} className="control-btn control-btn-ghost">Preview</button>
      </div>
      {preview ? (
        <MarkdownView>{value}</MarkdownView>
      ) : (
        <textarea
          rows={20}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="md-editor-textarea"
        />
      )}
    </div>
  );
}
