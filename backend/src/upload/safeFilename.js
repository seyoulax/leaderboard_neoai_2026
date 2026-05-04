const SAFE = /[^A-Za-z0-9._-]/g;

export function safeFilename(input, maxBytes = 80) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return 'file';
  let out = trimmed.replace(SAFE, '_').replace(/^\.+/, '_').replace(/_+/g, '_');
  if (out.length <= maxBytes) return out;
  const dot = out.lastIndexOf('.');
  const ext = dot > 0 ? out.slice(dot) : '';
  const base = dot > 0 ? out.slice(0, dot) : out;
  const room = Math.max(1, maxBytes - ext.length);
  return base.slice(0, room) + ext;
}
