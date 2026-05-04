import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { nativeTasks } from '../api.js';

function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export default function NativeTaskFiles({ files, kind, compSlug, taskSlug }) {
  const { user } = useAuth();
  if (!files || !files.length) return <p className="status">Файлов нет</p>;
  return (
    <div>
      <table className="file-table">
        <thead>
          <tr>
            <th>Имя</th>
            <th>Размер</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => (
            <tr key={f.id}>
              <td>
                {f.displayName}
                {f.description ? <span className="muted"> — {f.description}</span> : null}
              </td>
              <td className="mono">{fmtSize(f.sizeBytes)}</td>
              <td>
                {user ? (
                  <a href={nativeTasks.fileUrl(compSlug, taskSlug, f.id)} className="control-btn control-btn-ghost">
                    Скачать
                  </a>
                ) : (
                  <Link to="/login" className="control-btn control-btn-ghost">Войти для скачивания</Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {user && files.length > 1 && (
        <p style={{ marginTop: 12 }}>
          <a href={nativeTasks.zipUrl(compSlug, taskSlug, kind)} className="control-btn">
            Скачать всё zip
          </a>
        </p>
      )}
    </div>
  );
}
