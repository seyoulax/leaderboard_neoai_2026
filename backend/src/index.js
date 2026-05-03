import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
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
const TASKS_FILE = path.resolve(__dirname, '..', process.env.TASKS_FILE || './data/tasks.json');
const BOARDS_FILE = path.resolve(__dirname, '..', process.env.BOARDS_FILE || './data/boards.json');
const PARTICIPANTS_FILE = path.resolve(__dirname, '..', process.env.PARTICIPANTS_FILE || './data/participants.json');
const PRIVATE_DIR = path.resolve(__dirname, '..', process.env.PRIVATE_DIR || './data/private');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 3000);

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

async function loadTasks() {
  const raw = await fs.readFile(TASKS_FILE, 'utf8');
  return validateTasks(JSON.parse(raw));
}

async function saveTasks(tasks) {
  const body = JSON.stringify(tasks, null, 2) + '\n';
  await fs.writeFile(TASKS_FILE, body, 'utf8');
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

async function loadBoards() {
  try {
    const raw = await fs.readFile(BOARDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tasks = await loadTasks();
    const known = new Set(tasks.map((t) => t.slug));

    const sanitized = [];
    for (const board of parsed) {
      if (!board || typeof board !== 'object') continue;
      const filtered = Array.isArray(board.taskSlugs)
        ? board.taskSlugs.filter((s) => typeof s === 'string' && known.has(s.trim()))
        : [];
      if (filtered.length === 0) {
        console.warn(`[boards] skipping '${board.slug}' — no known task slugs left`);
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

async function saveBoards(boards) {
  const body = JSON.stringify(boards, null, 2) + '\n';
  await fs.writeFile(BOARDS_FILE, body, 'utf8');
}

async function loadParticipants() {
  try {
    const raw = await fs.readFile(PARTICIPANTS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

let participants = [];
let currentParticipantId = null;

const app = express();
app.set('trust proxy', true);
app.use(cors());
app.use(express.json());

let cache = {
  updatedAt: null,
  overall: [],
  byTask: {},
  privateOverall: [],
  privateByTask: {},
  privateTaskSlugs: [],
  tasks: [],
  errors: [],
  isRefreshing: false,
};

async function refreshCache() {
  if (cache.isRefreshing) {
    return;
  }

  cache.isRefreshing = true;

  try {
    const tasks = await loadTasks();

    const previousByTask = cache.byTask || {};
    const taskRows = [];
    const errors = [];

    for (const task of tasks) {
      try {
        const rows = await fetchCompetitionLeaderboard({
          competition: task.competition,
          kaggleCmd: KAGGLE_CMD,
        });
        taskRows.push({
          ...task,
          updatedAt: new Date().toISOString(),
          rows,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const short = `${task.slug}: ${message.split('\n')[0]}`;
        console.error(`[refresh] task ${task.slug} failed: ${message}`);
        errors.push({ message: short, at: new Date().toISOString() });
        const prev = previousByTask[task.slug];
        if (prev && Array.isArray(prev.entries)) {
          taskRows.push({
            ...task,
            updatedAt: prev.updatedAt || cache.updatedAt,
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

    const result = buildLeaderboards(taskRows);
    annotateWithDeltas(result, { byTask: cache.byTask, overall: cache.overall });

    const privateTaskRows = [];
    const privateTaskSlugs = [];
    for (const task of tasks) {
      const file = await readPrivateFile(PRIVATE_DIR, task.slug).catch(() => null);
      if (!file) continue;
      let records;
      try {
        records = parsePrivateCsv(file.raw);
      } catch (e) {
        console.warn(`[private] parse failed for ${task.slug}: ${e.message}`);
        continue;
      }
      if (!records.length) continue;
      const rows = buildPrivateRows({ records, higherIsBetter: task.higherIsBetter, participants });
      privateTaskRows.push({ ...task, updatedAt: file.updatedAt, rows });
      privateTaskSlugs.push(task.slug);
    }

    const privateResult = buildLeaderboards(privateTaskRows);
    annotateWithDeltas(privateResult, { byTask: cache.privateByTask, overall: cache.privateOverall });

    cache = {
      ...cache,
      updatedAt: new Date().toISOString(),
      tasks,
      overall: result.overall,
      byTask: result.byTask,
      privateOverall: privateResult.overall,
      privateByTask: privateResult.byTask,
      privateTaskSlugs,
      errors,
      isRefreshing: false,
    };

    console.log(`[refresh] OK ${cache.updatedAt}${errors.length ? ` (${errors.length} task errors)` : ''}`);
  } catch (error) {
    cache = {
      ...cache,
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        },
      ],
      isRefreshing: false,
    };

    console.error('[refresh] FAILED', error);
  }
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
    errors: cache.errors,
  });
});

app.get('/api/tasks/:slug', (req, res) => {
  const wanted = String(req.params.slug || '').toLowerCase();
  const findKey = (map) =>
    Object.keys(map).find((k) => k.toLowerCase() === wanted);
  const taskKey = findKey(cache.byTask);
  const privateKey = findKey(cache.privateByTask);
  const task = taskKey ? cache.byTask[taskKey] : null;
  const privateTask = privateKey ? cache.privateByTask[privateKey] : null;
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

function findKaggleStats(kaggleId) {
  if (!kaggleId) return null;
  const key = String(kaggleId).toLowerCase();
  const row = (cache.overall || []).find(
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

  participants = await loadParticipants();
  if (participants.length > 0) {
    currentParticipantId = participants[0].id;
  }

  await refreshCache();
  setInterval(refreshCache, REFRESH_MS);
});
