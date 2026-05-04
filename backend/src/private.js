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

function isAllSubmissionsFormat(records) {
  if (!records.length) return false;
  const r = records[0];
  return (
    Object.prototype.hasOwnProperty.call(r, 'UserName') &&
    Object.prototype.hasOwnProperty.call(r, 'IsSelected') &&
    Object.prototype.hasOwnProperty.call(r, 'PublicScore') &&
    Object.prototype.hasOwnProperty.call(r, 'PrivateScore')
  );
}

// Mirrors calc_scores.py:get_final_score
function pickFinalPrivate(subs, higherIsBetter) {
  const cmp = higherIsBetter ? (a, b) => a - b : (a, b) => b - a;
  const best = (arr) => arr.reduce((acc, v) => (acc === null || cmp(v, acc) > 0 ? v : acc), null);

  const selected = subs.filter((s) => s.selected);
  const nonSelected = subs.filter((s) => !s.selected);

  if (selected.length === 2) {
    return best(selected.map((s) => s.private));
  }
  if (selected.length === 1) {
    const cand = [selected[0]];
    if (nonSelected.length) {
      let bestNon = nonSelected[0];
      for (const s of nonSelected) {
        if (cmp(s.public, bestNon.public) > 0) bestNon = s;
      }
      cand.push(bestNon);
    }
    return best(cand.map((c) => c.private));
  }
  const sorted = subs.slice().sort((a, b) => cmp(b.public, a.public));
  const top2 = sorted.slice(0, 2);
  return best(top2.map((s) => s.private));
}

function processAllSubmissions(records, higherIsBetter) {
  const byUser = new Map();
  for (const r of records) {
    const user = String(r.UserName || '').trim();
    if (!user) continue;
    const pub = Number(r.PublicScore);
    const priv = Number(r.PrivateScore);
    if (!Number.isFinite(pub) || !Number.isFinite(priv)) continue;
    if (!byUser.has(user)) byUser.set(user, []);
    byUser.get(user).push({
      selected: String(r.IsSelected).toLowerCase() === 'true',
      public: pub,
      private: priv,
    });
  }

  const out = [];
  for (const [user, subs] of byUser) {
    const score = pickFinalPrivate(subs, higherIsBetter);
    if (Number.isFinite(score)) out.push({ kaggleId: user, score });
  }
  return out;
}

export function parsePrivateCsv(raw, { higherIsBetter = true } = {}) {
  if (!raw || !raw.trim()) return [];
  const records = parse(raw, { columns: true, skip_empty_lines: true, bom: true, trim: true });

  if (isAllSubmissionsFormat(records)) {
    return processAllSubmissions(records, higherIsBetter);
  }

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
