import fs from 'node:fs/promises';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED_SLUGS = new Set(['admin', 'obs', 'competitions', 'api', 'static', 'assets']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const VALID_PRESETS = new Set(['default', 'highlight-rising', 'minimal']);

function validateTheme(input, idx) {
  if (input == null) return null;
  if (typeof input !== 'object') {
    throw new Error(`competition #${idx + 1}: theme must be an object`);
  }
  const out = {};
  if (input.accent !== undefined && input.accent !== null && input.accent !== '') {
    if (typeof input.accent !== 'string' || !HEX_RE.test(input.accent.trim())) {
      throw new Error(`competition #${idx + 1}: theme.accent must be #RRGGBB`);
    }
    out.accent = input.accent.trim().toLowerCase();
  }
  if (input.preset !== undefined && input.preset !== null && input.preset !== '') {
    if (!VALID_PRESETS.has(input.preset)) {
      throw new Error(`competition #${idx + 1}: theme.preset must be one of ${[...VALID_PRESETS].join(', ')}`);
    }
    out.preset = input.preset;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function validateCompetitions(input) {
  if (!Array.isArray(input)) {
    throw new Error('competitions must be an array');
  }
  const seen = new Set();
  return input.map((c, idx) => {
    if (!c || typeof c !== 'object') {
      throw new Error(`competition #${idx + 1}: must be an object`);
    }
    const slug = typeof c.slug === 'string' ? c.slug.trim() : '';
    const title = typeof c.title === 'string' ? c.title.trim() : '';
    if (!slug) throw new Error(`competition #${idx + 1}: slug is required`);
    if (!SLUG_PATTERN.test(slug)) {
      throw new Error(`competition #${idx + 1}: slug must match ${SLUG_PATTERN}`);
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new Error(`competition #${idx + 1}: slug '${slug}' is reserved`);
    }
    if (!title) throw new Error(`competition #${idx + 1}: title is required`);
    if (title.length > 200) {
      throw new Error(`competition #${idx + 1}: title too long`);
    }
    if (seen.has(slug)) throw new Error(`duplicate slug: ${slug}`);
    seen.add(slug);

    const result = { slug, title };
    if (typeof c.subtitle === 'string' && c.subtitle.trim()) {
      const sub = c.subtitle.trim();
      if (sub.length > 500) {
        throw new Error(`competition #${idx + 1}: subtitle too long`);
      }
      result.subtitle = sub;
    }
    result.order = typeof c.order === 'number' && Number.isFinite(c.order) ? c.order : 0;
    result.visible = c.visible === undefined ? true : c.visible === true;
    result.type = c.type === 'native' ? 'native' : 'kaggle';
    result.visibility = c.visibility === 'unlisted' ? 'unlisted' : 'public';
    const theme = validateTheme(c.theme, idx);
    if (theme) result.theme = theme;
    return result;
  });
}

export async function loadCompetitions(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return validateCompetitions(JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

export async function saveCompetitions(filePath, list) {
  const validated = validateCompetitions(list);
  const body = JSON.stringify(validated, null, 2) + '\n';
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, filePath);
  return validated;
}
