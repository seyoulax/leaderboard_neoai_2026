import fs from 'node:fs/promises';
import path from 'node:path';

// Whitelisted theme tokens. Values must look like hex (#rrggbb) or be empty
// (empty = use compiled-in default from styles.css :root).
const TOKEN_KEYS = ['bg', 'card', 'ink', 'muted', 'line', 'accent'];
const HEX_RE = /^#?[0-9a-f]{6}$/i;

export function emptyTheme() {
  const out = {};
  for (const k of TOKEN_KEYS) out[k] = '';
  return out;
}

function normalizeHex(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  if (!HEX_RE.test(s)) return '';
  return s.startsWith('#') ? s.toLowerCase() : `#${s.toLowerCase()}`;
}

export function sanitizeTheme(input) {
  const out = emptyTheme();
  if (!input || typeof input !== 'object') return out;
  for (const k of TOKEN_KEYS) {
    if (k in input) out[k] = normalizeHex(input[k]);
  }
  return out;
}

export async function readTheme(dataDir) {
  const file = path.join(dataDir, 'theme.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return sanitizeTheme(JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return emptyTheme();
    throw e;
  }
}

export async function writeTheme(dataDir, theme) {
  const sanitized = sanitizeTheme(theme);
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, 'theme.json');
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(sanitized, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
  return sanitized;
}

export const THEME_TOKEN_KEYS = TOKEN_KEYS;
