import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadCompetitions, saveCompetitions, validateCompetitions } from './competitions.js';
import { migrate } from './migrate.js';
import { readCompetitionState, writeCompetitionState } from './state.js';
import { fetchCompetitionLeaderboard } from './kaggle.js';
import { buildLeaderboards } from './leaderboard.js';
import {
  parsePrivateCsv,
  buildPrivateRows,
  readPrivateFile,
  writePrivateFile,
  deletePrivateFile,
} from './private.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const REFRESH_MS = Number(process.env.REFRESH_MS || 60000);
const KAGGLE_CMD = process.env.KAGGLE_CMD || 'kaggle';
const DATA_DIR = path.resolve(__dirname, '..', process.env.DATA_DIR || './data');
const COMPETITIONS_FILE = path.join(DATA_DIR, 'competitions.json');
const COMPETITIONS_DIR = path.join(DATA_DIR, 'competitions');
const PRIVATE_DIR_BASE = path.join(DATA_DIR, 'private');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 3000);

function competitionDir(slug) {
  return path.join(COMPETITIONS_DIR, slug);
}

function privateDirFor(slug) {
  return path.join(PRIVATE_DIR_BASE, slug);
}

function validateTasks(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('tasks must be a non-empty array');
  }

  const seen = new Set();
  return input.map((task, idx) => {
    if (!task || typeof task !== 'object') {
      throw new Error(`task #${idx + 1}: must be an object`);
    }
    const slug = typeof task.slug === 'string' ? task.slug.trim() : '';
    const title = typeof task.title === 'string' ? task.title.trim() : '';
    const competition = typeof task.competition === 'string' ? task.competition.trim() : '';
    if (!slug) throw new Error(`task #${idx + 1}: slug is required`);
    if (!title) throw new Error(`task #${idx + 1}: title is required`);
    if (!competition) throw new Error(`task #${idx + 1}: competition is required`);
    const normSlug = slug.toLowerCase();
    if (seen.has(normSlug)) throw new Error(`duplicate slug: ${normSlug}`);
    seen.add(normSlug);

    const baselineScore = parseOptionalNumber(task.baselineScore, `task #${idx + 1}: baselineScore`);
    const authorScore = parseOptionalNumber(task.authorScore, `task #${idx + 1}: authorScore`);
    if (
      baselineScore !== null &&
      authorScore !== null &&
      baselineScore === authorScore
    ) {
      throw new Error(`task #${idx + 1}: baselineScore and authorScore must differ`);
    }

    const result = {
      slug: normSlug,
      title,
      competition,
      higherIsBetter: task.higherIsBetter !== false,
    };
    if (baselineScore !== null) result.baselineScore = baselineScore;
    if (authorScore !== null) result.authorScore = authorScore;
    return result;
  });
}

function parseOptionalNumber(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${label}: must be a number`);
  }
  return n;
}


function validateBoards(input, knownTaskSlugs) {
  if (!Array.isArray(input)) throw new Error('boards must be an array');
  const seen = new Set();
  return input.map((board, idx) => {
    if (!board || typeof board !== 'object') {
      throw new Error(`board #${idx + 1}: must be an object`);
    }
    const slug = typeof board.slug === 'string' ? board.slug.trim() : '';
    const title = typeof board.title === 'string' ? board.title.trim() : '';
    if (!slug) throw new Error(`board #${idx + 1}: slug is required`);
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
      throw new Error(`board #${idx + 1}: slug must be alphanumeric/hyphens`);
    }
    if (!title) throw new Error(`board #${idx + 1}: title is required`);
    if (seen.has(slug)) throw new Error(`duplicate board slug: ${slug}`);
    seen.add(slug);

    const taskSlugs = Array.isArray(board.taskSlugs) ? board.taskSlugs : [];
    const cleanTaskSlugs = [];
    for (const ts of taskSlugs) {
      if (typeof ts !== 'string' || !ts.trim()) {
        throw new Error(`board ${slug}: taskSlugs must be non-empty strings`);
      }
      const t = ts.trim();
      if (knownTaskSlugs && !knownTaskSlugs.has(t)) {
        throw new Error(`board ${slug}: unknown task slug '${t}'`);
      }
      cleanTaskSlugs.push(t);
    }
    if (cleanTaskSlugs.length === 0) {
      throw new Error(`board ${slug}: taskSlugs must contain at least one task`);
    }

    const order = Number.isFinite(Number(board.order)) ? Number(board.order) : 0;
    const visible = board.visible !== false;

    return { slug, title, taskSlugs: cleanTaskSlugs, visible, order };
  });
}

async function loadTasksFor(slug) {
  const file = path.join(competitionDir(slug), 'tasks.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return validateTasks(JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function saveTasksFor(slug, tasks) {
  await fs.mkdir(competitionDir(slug), { recursive: true });
  const file = path.join(competitionDir(slug), 'tasks.json');
  const body = JSON.stringify(tasks, null, 2) + '\n';
  await fs.writeFile(file, body, 'utf8');
}

async function loadBoardsFor(slug) {
  const file = path.join(competitionDir(slug), 'boards.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tasks = await loadTasksFor(slug);
    const known = new Set(tasks.map((t) => t.slug));
    const sanitized = [];
    for (const board of parsed) {
      if (!board || typeof board !== 'object') continue;
      const filtered = Array.isArray(board.taskSlugs)
        ? board.taskSlugs.filter((s) => typeof s === 'string' && known.has(s.trim()))
        : [];
      if (filtered.length === 0) {
        console.warn(`[boards] ${slug}: skipping '${board.slug}' — no known task slugs left`);
        continue;
      }
      sanitized.push({ ...board, taskSlugs: filtered });
    }
    return validateBoards(sanitized, known);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function saveBoardsFor(slug, boards) {
  await fs.mkdir(competitionDir(slug), { recursive: true });
  const file = path.join(competitionDir(slug), 'boards.json');
  const body = JSON.stringify(boards, null, 2) + '\n';
  await fs.writeFile(file, body, 'utf8');
}

async function loadParticipantsFor(slug) {
  const file = path.join(competitionDir(slug), 'participants.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function saveParticipantsFor(slug, participants) {
  if (!Array.isArray(participants)) {
    throw new Error('participants must be an array');
  }
  await fs.mkdir(competitionDir(slug), { recursive: true });
  const file = path.join(competitionDir(slug), 'participants.json');
  const body = JSON.stringify(participants, null, 2) + '\n';
  await fs.writeFile(file, body, 'utf8');
}

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

let cache = {
  isRefreshing: false,
  lastSweepAt: null,
  competitionsIndex: [],
  byCompetition: new Map(),
};

function emptyCompetitionCache() {
  return {
    updatedAt: null,
    tasks: [],
    overall: [],
    byTask: {},
    privateOverall: [],
    privateByTask: {},
    privateTaskSlugs: [],
    oursOverall: [],
    oursByTask: {},
    oursPrivateOverall: [],
    oursPrivateByTask: {},
    participants: [],
    currentParticipantId: null,
    errors: [],
  };
}

function getCompCache(slug) {
  let c = cache.byCompetition.get(slug);
  if (!c) {
    c = emptyCompetitionCache();
    cache.byCompetition.set(slug, c);
  }
  return c;
}

function buildOursKaggleSet(list) {
  const set = new Set();
  for (const p of list || []) {
    const id = (p && p.kaggleId ? String(p.kaggleId) : '').trim().toLowerCase();
    if (id) set.add(id);
  }
  return set;
}

function buildOursDisplayMap(list) {
  const map = new Map();
  for (const p of list || []) {
    const id = (p && p.kaggleId ? String(p.kaggleId) : '').trim().toLowerCase();
    if (!id) continue;
    const parts = (p.name || '').trim().split(/\s+/).filter(Boolean);
    const display = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : (parts[0] || '');
    if (display) map.set(id, display);
  }
  return map;
}

function filterRowsByOurs(rows, oursSet) {
  if (!oursSet || oursSet.size === 0) return [];
  return (rows || []).filter((r) => oursSet.has((r.nickname || '').toLowerCase()));
}

function projectTaskRowsToOurs(taskRows, oursSet) {
  return taskRows.map((t) => ({ ...t, rows: filterRowsByOurs(t.rows, oursSet) }));
}

function applyDisplayNames(result, displayMap) {
  if (!displayMap || displayMap.size === 0) return;
  const rename = (entry) => {
    const key = (entry.nickname || '').toLowerCase();
    const display = displayMap.get(key);
    if (display) entry.nickname = display;
  };
  for (const e of result.overall || []) rename(e);
  for (const slug of Object.keys(result.byTask || {})) {
    for (const e of result.byTask[slug].entries || []) rename(e);
  }
}

async function refreshAll() {
  if (cache.isRefreshing) {
    console.log('[refresh] skip: still refreshing');
    return;
  }
  cache.isRefreshing = true;
  try {
    cache.competitionsIndex = await loadCompetitions(COMPETITIONS_FILE);
    for (const comp of cache.competitionsIndex) {
      try {
        await refreshCompetition(comp.slug);
      } catch (e) {
        console.error(`[refresh] competition ${comp.slug} failed:`, e);
      }
    }
    cache.lastSweepAt = new Date().toISOString();
  } finally {
    cache.isRefreshing = false;
  }
}

async function refreshCompetition(slug) {
  const tasks = await loadTasksFor(slug);
  const compCache = getCompCache(slug);
  const previousByTask = compCache.byTask || {};
  const taskRows = [];
  const errors = [];

  for (const task of tasks) {
    try {
      const rows = await fetchCompetitionLeaderboard({
        competition: task.competition,
        kaggleCmd: KAGGLE_CMD,
      });
      taskRows.push({ ...task, updatedAt: new Date().toISOString(), rows });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const short = `${task.slug}: ${message.split('\n')[0]}`;
      console.error(`[refresh] ${slug}/${task.slug} failed: ${message}`);
      errors.push({ message: short, at: new Date().toISOString() });
      const prev = previousByTask[task.slug];
      if (prev && Array.isArray(prev.entries)) {
        taskRows.push({
          ...task,
          updatedAt: prev.updatedAt || compCache.updatedAt,
          rows: prev.entries.map((e) => ({
            participantKey: e.participantKey,
            nickname: e.nickname,
            teamName: e.teamName,
            rank: e.rank,
            score: e.score,
          })),
        });
      }
    }
    await sleep(REQUEST_GAP_MS);
  }

  const participants = await loadParticipantsFor(slug);
  const state = await readCompetitionState(competitionDir(slug));
  const oursSet = buildOursKaggleSet(participants);
  const oursDisplayMap = buildOursDisplayMap(participants);

  const result = buildLeaderboards(taskRows);
  annotateWithDeltas(result, { byTask: compCache.byTask, overall: compCache.overall });

  const oursResult = buildLeaderboards(projectTaskRowsToOurs(taskRows, oursSet));
  applyDisplayNames(oursResult, oursDisplayMap);
  annotateWithDeltas(oursResult, { byTask: compCache.oursByTask, overall: compCache.oursOverall });

  const privDir = privateDirFor(slug);
  const privateTaskRows = [];
  const privateTaskSlugs = [];
  for (const task of tasks) {
    const file = await readPrivateFile(privDir, task.slug).catch(() => null);
    if (!file) continue;
    let records;
    try {
      records = parsePrivateCsv(file.raw);
    } catch (e) {
      console.warn(`[private] parse failed for ${slug}/${task.slug}: ${e.message}`);
      continue;
    }
    if (!records.length) continue;
    const rows = buildPrivateRows({ records, higherIsBetter: task.higherIsBetter, participants });
    privateTaskRows.push({ ...task, updatedAt: file.updatedAt, rows });
    privateTaskSlugs.push(task.slug);
  }

  const privateResult = buildLeaderboards(privateTaskRows);
  annotateWithDeltas(privateResult, { byTask: compCache.privateByTask, overall: compCache.privateOverall });

  const oursPrivateResult = buildLeaderboards(projectTaskRowsToOurs(privateTaskRows, oursSet));
  applyDisplayNames(oursPrivateResult, oursDisplayMap);
  annotateWithDeltas(oursPrivateResult, {
    byTask: compCache.oursPrivateByTask,
    overall: compCache.oursPrivateOverall,
  });

  cache.byCompetition.set(slug, {
    updatedAt: new Date().toISOString(),
    tasks,
    overall: result.overall,
    byTask: result.byTask,
    privateOverall: privateResult.overall,
    privateByTask: privateResult.byTask,
    privateTaskSlugs,
    oursOverall: oursResult.overall,
    oursByTask: oursResult.byTask,
    oursPrivateOverall: oursPrivateResult.overall,
    oursPrivateByTask: oursPrivateResult.byTask,
    participants,
    currentParticipantId: state.currentParticipantId,
    errors,
  });

  console.log(`[refresh] ${slug} OK${errors.length ? ` (${errors.length} task errors)` : ''}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function annotateWithDeltas(result, prevCache) {
  const prevTaskPoints = new Map();
  const prevTotalPoints = new Map();

  for (const slug of Object.keys(prevCache.byTask || {})) {
    const entries = prevCache.byTask[slug]?.entries || [];
    for (const e of entries) {
      if (e.participantKey) prevTaskPoints.set(`${slug}|${e.participantKey}`, e.points);
    }
  }
  for (const e of prevCache.overall || []) {
    if (e.participantKey) prevTotalPoints.set(e.participantKey, e.totalPoints);
  }

  for (const slug of Object.keys(result.byTask)) {
    for (const e of result.byTask[slug].entries) {
      const prev = prevTaskPoints.get(`${slug}|${e.participantKey}`);
      e.previousPoints = prev !== undefined ? prev : null;
    }
  }
  for (const ovr of result.overall) {
    const prev = prevTotalPoints.get(ovr.participantKey);
    ovr.previousTotalPoints = prev !== undefined ? prev : null;
    for (const slug of Object.keys(ovr.tasks || {})) {
      const prevP = prevTaskPoints.get(`${slug}|${ovr.participantKey}`);
      ovr.tasks[slug].previousPoints = prevP !== undefined ? prevP : null;
    }
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    updatedAt: cache.updatedAt,
    isRefreshing: cache.isRefreshing,
    errors: cache.errors,
  });
});

app.get('/api/tasks', (_req, res) => {
  res.json({ tasks: cache.tasks, updatedAt: cache.updatedAt, errors: cache.errors });
});

app.get('/api/leaderboard', (_req, res) => {
  res.json({
    updatedAt: cache.updatedAt,
    tasks: cache.tasks,
    overall: cache.overall,
    privateOverall: cache.privateOverall,
    privateByTask: cache.privateByTask,
    privateTaskSlugs: cache.privateTaskSlugs,
    oursOverall: cache.oursOverall,
    oursByTask: cache.oursByTask,
    oursPrivateOverall: cache.oursPrivateOverall,
    oursPrivateByTask: cache.oursPrivateByTask,
    errors: cache.errors,
  });
});

app.get('/api/tasks/:slug', (req, res) => {
  const wanted = String(req.params.slug || '').toLowerCase();
  const findKey = (map) =>
    Object.keys(map).find((k) => k.toLowerCase() === wanted);
  const taskKey = findKey(cache.byTask);
  const privateKey = findKey(cache.privateByTask);
  const oursKey = findKey(cache.oursByTask);
  const oursPrivateKey = findKey(cache.oursPrivateByTask);
  const task = taskKey ? cache.byTask[taskKey] : null;
  const privateTask = privateKey ? cache.privateByTask[privateKey] : null;
  const oursTask = oursKey ? cache.oursByTask[oursKey] : null;
  const oursPrivateTask = oursPrivateKey ? cache.oursPrivateByTask[oursPrivateKey] : null;
  const meta = (cache.tasks || []).find((t) => t.slug.toLowerCase() === wanted);

  if (!task && !privateTask && !meta) {
    res.status(404).json({ error: `Task '${req.params.slug}' not found` });
    return;
  }

  const fallback = meta
    ? {
        slug: meta.slug,
        title: meta.title,
        competition: meta.competition,
        higherIsBetter: meta.higherIsBetter,
        baselineScore: meta.baselineScore,
        authorScore: meta.authorScore,
        updatedAt: cache.updatedAt,
        entries: [],
      }
    : { ...privateTask, entries: [] };

  const taskErrors = (cache.errors || []).filter((e) =>
    typeof e.message === 'string' && e.message.toLowerCase().startsWith(`${wanted}:`)
  );

  res.json({
    updatedAt: cache.updatedAt,
    task: task || fallback,
    privateTask,
    oursTask,
    oursPrivateTask,
    errors: taskErrors.length ? taskErrors : cache.errors,
  });
});

app.post('/api/refresh', async (_req, res) => {
  await refreshCache();
  res.json({ ok: true, updatedAt: cache.updatedAt, errors: cache.errors });
});

function safeEqualToken(provided, expected) {
  const a = Buffer.from(provided || '', 'utf8');
  const b = Buffer.from(expected || '', 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: 'admin disabled: ADMIN_TOKEN is not set on the server' });
    return;
  }
  const token = req.get('x-admin-token') || '';
  if (!safeEqualToken(token, ADMIN_TOKEN)) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    console.warn(`[admin] failed auth from ${ip}`);
    res.status(401).json({ error: 'invalid admin token' });
    return;
  }
  next();
}

app.get('/api/admin/tasks', requireAdmin, async (_req, res) => {
  try {
    const raw = await fs.readFile(TASKS_FILE, 'utf8');
    res.json({ tasks: JSON.parse(raw) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/admin/tasks', requireAdmin, async (req, res) => {
  try {
    const tasks = validateTasks(req.body?.tasks);
    await saveTasks(tasks);
    res.json({ ok: true, tasks });
    refreshCache().catch((e) => console.error('[refresh after save] FAILED', e));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/boards', async (_req, res) => {
  try {
    const boards = await loadBoards();
    res.json({ boards });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/admin/boards', requireAdmin, async (_req, res) => {
  try {
    const raw = await fs.readFile(BOARDS_FILE, 'utf8').catch((e) => {
      if (e.code === 'ENOENT') return '[]';
      throw e;
    });
    res.json({ boards: JSON.parse(raw) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/admin/tasks/:slug/private', requireAdmin, async (req, res) => {
  try {
    const file = await readPrivateFile(PRIVATE_DIR, req.params.slug);
    if (!file) {
      res.json({ exists: false });
      return;
    }
    let count = 0;
    try {
      count = parsePrivateCsv(file.raw).length;
    } catch {}
    res.json({ exists: true, csv: file.raw, updatedAt: file.updatedAt, count });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/admin/tasks/:slug/private', requireAdmin, async (req, res) => {
  try {
    const tasks = await loadTasks();
    if (!tasks.find((t) => t.slug === req.params.slug)) {
      res.status(404).json({ error: `task '${req.params.slug}' not found` });
      return;
    }
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const records = parsePrivateCsv(csv);
    if (!records.length) {
      res.status(400).json({ error: 'no valid rows parsed (need columns kaggle_id and raw_score)' });
      return;
    }
    await writePrivateFile(PRIVATE_DIR, req.params.slug, csv);
    res.json({ ok: true, count: records.length });
    refreshCache().catch((e) => console.error('[refresh after private upload] FAILED', e));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/admin/tasks/:slug/private', requireAdmin, async (req, res) => {
  try {
    await deletePrivateFile(PRIVATE_DIR, req.params.slug);
    res.json({ ok: true });
    refreshCache().catch((e) => console.error('[refresh after private delete] FAILED', e));
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/admin/boards', requireAdmin, async (req, res) => {
  try {
    const tasks = await loadTasks();
    const known = new Set(tasks.map((t) => t.slug));
    const boards = validateBoards(req.body?.boards, known);
    await saveBoards(boards);
    res.json({ ok: true, boards });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/participants', async (_req, res) => {
  participants = await loadParticipants();
  res.json({
    participants: participants.map((p) => ({
      id: p.id,
      name: p.name,
      kaggleId: p.kaggleId || null,
    })),
    currentId: currentParticipantId,
  });
});

function findKaggleStats(slug, kaggleId) {
  if (!kaggleId) return null;
  const compCache = cache.byCompetition.get(slug);
  if (!compCache) return null;
  const key = String(kaggleId).toLowerCase();
  const row = (compCache.overall || []).find(
    (r) => (r.nickname || r.participantKey || '').toLowerCase() === key
  );
  if (!row) return null;
  return {
    place: row.place,
    totalPoints: row.totalPoints,
    previousTotalPoints: row.previousTotalPoints ?? null,
    nickname: row.nickname,
    teamName: row.teamName,
    tasks: row.tasks,
  };
}

app.get('/api/card', (_req, res) => {
  const current = participants.find((p) => p.id === currentParticipantId);
  const kaggleStats = current ? findKaggleStats(current.kaggleId) : null;

  res.json({
    current: current || null,
    currentId: currentParticipantId,
    kaggleStats,
    updatedAt: cache.updatedAt,
  });
});

app.post('/api/card', async (req, res) => {
  const { id } = req.body || {};

  if (id === null) {
    currentParticipantId = null;
    res.json({ ok: true, currentId: null, current: null });
    return;
  }

  if (typeof id !== 'string') {
    res.status(400).json({ error: 'id must be a string or null' });
    return;
  }

  participants = await loadParticipants();
  const found = participants.find((p) => p.id === id);

  if (!found) {
    res.status(404).json({ error: `participant '${id}' not found` });
    return;
  }

  currentParticipantId = id;
  res.json({ ok: true, currentId: id, current: found });
});

app.listen(PORT, async () => {
  console.log(`Backend started on http://localhost:${PORT}`);
  try {
    const result = await migrate(DATA_DIR);
    if (result.migrated) {
      console.log(`[migrate] OK: legacy → ${result.competitionSlug}, backup: ${result.backupDir}`);
    }
  } catch (e) {
    console.error('[migrate] FAILED', e);
  }
  await refreshAll();
  setInterval(refreshAll, REFRESH_MS);
});
