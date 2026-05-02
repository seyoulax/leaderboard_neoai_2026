import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { fetchCompetitionLeaderboard } from './kaggle.js';
import { buildLeaderboards } from './leaderboard.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const REFRESH_MS = Number(process.env.REFRESH_MS || 60000);
const KAGGLE_CMD = process.env.KAGGLE_CMD || 'kaggle';
const TASKS_FILE = path.resolve(__dirname, '..', process.env.TASKS_FILE || './data/tasks.json');
const PARTICIPANTS_FILE = path.resolve(__dirname, '..', process.env.PARTICIPANTS_FILE || './data/participants.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

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
    if (seen.has(slug)) throw new Error(`duplicate slug: ${slug}`);
    seen.add(slug);

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
      slug,
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
app.use(cors());
app.use(express.json());

let cache = {
  updatedAt: null,
  overall: [],
  byTask: {},
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

    const taskRows = await Promise.all(
      tasks.map(async (task) => {
        const rows = await fetchCompetitionLeaderboard({
          competition: task.competition,
          kaggleCmd: KAGGLE_CMD,
        });

        return {
          ...task,
          updatedAt: new Date().toISOString(),
          rows,
        };
      })
    );

    const result = buildLeaderboards(taskRows);

    cache = {
      ...cache,
      updatedAt: new Date().toISOString(),
      tasks,
      overall: result.overall,
      byTask: result.byTask,
      errors: [],
      isRefreshing: false,
    };

    console.log(`[refresh] OK ${cache.updatedAt}`);
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
    errors: cache.errors,
  });
});

app.get('/api/tasks/:slug', (req, res) => {
  const task = cache.byTask[req.params.slug];

  if (!task) {
    res.status(404).json({ error: `Task '${req.params.slug}' not found` });
    return;
  }

  res.json({
    updatedAt: cache.updatedAt,
    task,
    errors: cache.errors,
  });
});

app.post('/api/refresh', async (_req, res) => {
  await refreshCache();
  res.json({ ok: true, updatedAt: cache.updatedAt, errors: cache.errors });
});

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: 'admin disabled: ADMIN_TOKEN is not set on the server' });
    return;
  }
  const token = req.get('x-admin-token') || '';
  if (token !== ADMIN_TOKEN) {
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
