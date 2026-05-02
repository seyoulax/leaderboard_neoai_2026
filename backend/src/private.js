import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

function pickValue(row, keys) {
  for (const key of Object.keys(row)) {
    const lower = key.toLowerCase().replace(/[\s_-]/g, '');
    for (const cand of keys) {
      if (cand.toLowerCase().replace(/[\s_-]/g, '') === lower) {
        return row[key];
      }
    }
  }
  return null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parsePrivateCsv(raw) {
  if (!raw || !raw.trim()) return [];
  const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true, trim: true });
  const out = [];
  for (const r of records) {
    const id = pickValue(r, ['kaggle_id', 'kaggleId', 'kaggle', 'username', 'nickname', 'user']);
    const score = toNumber(pickValue(r, ['raw_score', 'rawScore', 'score', 'private_score', 'privateScore']));
    if (!id || score === null) continue;
    out.push({ kaggleId: String(id).trim(), score });
  }
  return out;
}

export function buildPrivateRows({ records, higherIsBetter, participants }) {
  const sorted = records.slice().sort((a, b) => (higherIsBetter ? b.score - a.score : a.score - b.score));
  const map = new Map(
    (participants || [])
      .filter((p) => p.kaggleId)
      .map((p) => [String(p.kaggleId).toLowerCase(), p])
  );
  return sorted.map((r, i) => {
    const p = map.get(r.kaggleId.toLowerCase());
    return {
      participantKey: r.kaggleId.toLowerCase(),
      nickname: r.kaggleId,
      teamName: p?.name || null,
      rank: i + 1,
      score: r.score,
    };
  });
}

export async function readPrivateFile(privateDir, slug) {
  const file = path.join(privateDir, `${slug}.csv`);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const meta = await fs.stat(file);
    return { raw, updatedAt: meta.mtime.toISOString() };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writePrivateFile(privateDir, slug, csvBody) {
  await fs.mkdir(privateDir, { recursive: true });
  const file = path.join(privateDir, `${slug}.csv`);
  await fs.writeFile(file, csvBody, 'utf8');
}

export async function deletePrivateFile(privateDir, slug) {
  const file = path.join(privateDir, `${slug}.csv`);
  try {
    await fs.unlink(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
