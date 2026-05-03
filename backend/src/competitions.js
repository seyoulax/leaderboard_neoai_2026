import fs from 'node:fs/promises';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED_SLUGS = new Set(['admin', 'obs', 'competitions', 'api', 'static', 'assets']);

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
