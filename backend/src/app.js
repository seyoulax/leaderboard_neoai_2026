import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompetitions } from './competitions.js';
import { loadUser, requireAdmin } from './auth/middleware.js';
import { createAuthRouter } from './routes/auth.js';
import { createMeRouter } from './routes/me.js';
import { createNativeTasksAdminRouter } from './routes/nativeTasksAdmin.js';
import { createNativeTasksPublicRouter } from './routes/nativeTasksPublic.js';
import { createSubmissionsPublicRouter } from './routes/submissionsPublic.js';
import { createSubmissionsAdminRouter } from './routes/submissionsAdmin.js';
import { createMembershipRouter } from './routes/membership.js';
import { listNativeTasks } from './db/nativeTasksRepo.js';
import {
  listActiveCompetitions,
  listVisibleCompetitions,
  searchPublicCompetitions,
  getCompetition,
  insertCompetition,
  softDeleteCompetition,
  bulkReplaceCompetitions,
} from './db/competitionsRepo.js';
import { readCompetitionState, writeCompetitionState } from './state.js';
import { fetchCompetitionLeaderboard } from './kaggle.js';
import { buildLeaderboards } from './leaderboard.js';
import {
  parsePrivateCsv,
  buildPrivateRows,
  readPrivateFile,
  writePrivateFile,
  deletePrivateFile,
  readPublicFile,
  writePublicFile,
  deletePublicFile,
  parsePublicCsv,
} from './private.js';
import { buildNativeLeaderboard } from './scoring/nativeLeaderboard.js';
import { makeSnapshotCache } from './scoring/snapshotCache.js';
import { setOnScoredCallback } from './scoring/worker.js';
import { applyBonusToOverall } from './leaderboardBonus.js';
import {
  setBonusPoints as setMemberBonusPoints,
  listMembersWithBonus,
} from './db/membersRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KAGGLE_CMD = process.env.KAGGLE_CMD || 'kaggle';
export const DATA_DIR = path.resolve(__dirname, '..', process.env.DATA_DIR || './data');
const COMPETITIONS_DIR = path.join(DATA_DIR, 'competitions');
const PRIVATE_DIR_BASE = path.join(DATA_DIR, 'private');
const PUBLIC_CSV_DIR_BASE = path.join(DATA_DIR, 'public-csv');
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 3000);

let _dbForRefresh = null;
function getDbHandle() {
  if (!_dbForRefresh) throw new Error('refreshAll called before createApp({db})');
  return _dbForRefresh;
}

function competitionDir(slug) {
  return path.join(COMPETITIONS_DIR, slug);
}

function privateDirFor(slug) {
  return path.join(PRIVATE_DIR_BASE, slug);
}

function publicCsvDirFor(slug) {
  return path.join(PUBLIC_CSV_DIR_BASE, slug);
}

function cacheSnapshotFile(slug) {
  return path.join(competitionDir(slug), '_cache-snapshot.json');
}

const SNAPSHOT_FIELDS = [
  'updatedAt', 'tasks',
  'overall', 'byTask',
  'privateOverall', 'privateByTask', 'privateTaskSlugs',
  'oursOverall', 'oursByTask',
  'oursPrivateOverall', 'oursPrivateByTask',
  'groupsMeta', 'groupsResults',
  'errors',
];

async function writeCacheSnapshot(slug, cc) {
  try {
    const file = cacheSnapshotFile(slug);
    const snap = {};
    for (const k of SNAPSHOT_FIELDS) snap[k] = cc[k];
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snap), 'utf8');
    await fs.rename(tmp, file);
  } catch (e) {
    console.error(`[snapshot] write failed for ${slug}:`, e instanceof Error ? e.message : e);
  }
}

async function readCacheSnapshot(slug) {
  try {
    const raw = await fs.readFile(cacheSnapshotFile(slug), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    console.error(`[snapshot] read failed for ${slug}:`, e instanceof Error ? e.message : e);
    return null;
  }
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
    // competition (Kaggle slug) is optional — task may instead be served from an
    // admin-uploaded public CSV (data/public-csv/<comp>/<task>.csv).
    const normSlug = slug.toLowerCase();
    if (seen.has(normSlug)) throw new Error(`duplicate slug: ${normSlug}`);
    seen.add(normSlug);

    const baselineScorePublic = parseOptionalNumber(
      task.baselineScorePublic ?? task.baselineScore,
      `task #${idx + 1}: baselineScorePublic`
    );
    const authorScorePublic = parseOptionalNumber(
      task.authorScorePublic ?? task.authorScore,
      `task #${idx + 1}: authorScorePublic`
    );
    const baselineScorePrivate = parseOptionalNumber(
      task.baselineScorePrivate ?? task.baselineScore,
      `task #${idx + 1}: baselineScorePrivate`
    );
    const authorScorePrivate = parseOptionalNumber(
      task.authorScorePrivate ?? task.authorScore,
      `task #${idx + 1}: authorScorePrivate`
    );
    if (
      baselineScorePublic !== null &&
      authorScorePublic !== null &&
      baselineScorePublic === authorScorePublic
    ) {
      throw new Error(`task #${idx + 1}: baselineScorePublic and authorScorePublic must differ`);
    }
    if (
      baselineScorePrivate !== null &&
      authorScorePrivate !== null &&
      baselineScorePrivate === authorScorePrivate
    ) {
      throw new Error(`task #${idx + 1}: baselineScorePrivate and authorScorePrivate must differ`);
    }

    const result = {
      slug: normSlug,
      title,
      competition,
      higherIsBetter: task.higherIsBetter !== false,
    };
    if (baselineScorePublic !== null) result.baselineScorePublic = baselineScorePublic;
    if (authorScorePublic !== null) result.authorScorePublic = authorScorePublic;
    if (baselineScorePrivate !== null) result.baselineScorePrivate = baselineScorePrivate;
    if (authorScorePrivate !== null) result.authorScorePrivate = authorScorePrivate;
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
    const showBonusPoints = Boolean(board.showBonusPoints);

    return { slug, title, taskSlugs: cleanTaskSlugs, visible, order, showBonusPoints };
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
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
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
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

function validateCategories(input, knownTaskSlugs, knownBoardSlugs) {
  if (!Array.isArray(input)) throw new Error('categories must be an array');
  const seen = new Set();
  return input.map((cat, idx) => {
    if (!cat || typeof cat !== 'object') {
      throw new Error(`category #${idx + 1}: must be an object`);
    }
    const slug = typeof cat.slug === 'string' ? cat.slug.trim() : '';
    const title = typeof cat.title === 'string' ? cat.title.trim() : '';
    if (!slug) throw new Error(`category #${idx + 1}: slug is required`);
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
      throw new Error(`category #${idx + 1}: slug must be alphanumeric/hyphens`);
    }
    if (slug === '_all') {
      throw new Error(`category slug '_all' is reserved`);
    }
    if (!title) throw new Error(`category #${idx + 1}: title is required`);
    if (seen.has(slug)) throw new Error(`duplicate category slug: ${slug}`);
    seen.add(slug);

    const taskSlugs = Array.isArray(cat.taskSlugs) ? cat.taskSlugs : [];
    const cleanTaskSlugs = [];
    for (const ts of taskSlugs) {
      if (typeof ts !== 'string' || !ts.trim()) {
        throw new Error(`category ${slug}: taskSlugs must be non-empty strings`);
      }
      const t = ts.trim();
      if (knownTaskSlugs && !knownTaskSlugs.has(t)) {
        throw new Error(`category ${slug}: unknown task slug '${t}'`);
      }
      cleanTaskSlugs.push(t);
    }

    const boardSlugs = Array.isArray(cat.boardSlugs) ? cat.boardSlugs : [];
    const cleanBoardSlugs = [];
    for (const bs of boardSlugs) {
      if (typeof bs !== 'string' || !bs.trim()) {
        throw new Error(`category ${slug}: boardSlugs must be non-empty strings`);
      }
      const b = bs.trim();
      if (knownBoardSlugs && !knownBoardSlugs.has(b)) {
        throw new Error(`category ${slug}: unknown board slug '${b}'`);
      }
      cleanBoardSlugs.push(b);
    }

    const order = Number.isFinite(Number(cat.order)) ? Number(cat.order) : 0;
    const visible = cat.visible !== false;

    return { slug, title, taskSlugs: cleanTaskSlugs, boardSlugs: cleanBoardSlugs, visible, order };
  });
}

async function loadCategoriesFor(slug) {
  const file = path.join(competitionDir(slug), 'categories.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tasks = await loadTasksFor(slug);
    const boards = await loadBoardsFor(slug);
    const knownTasks = new Set(tasks.map((t) => t.slug));
    const knownBoards = new Set(boards.map((b) => b.slug));
    const sanitized = [];
    for (const cat of parsed) {
      if (!cat || typeof cat !== 'object') continue;
      const filteredTasks = Array.isArray(cat.taskSlugs)
        ? cat.taskSlugs.filter((s) => typeof s === 'string' && knownTasks.has(s.trim()))
        : [];
      const filteredBoards = Array.isArray(cat.boardSlugs)
        ? cat.boardSlugs.filter((s) => typeof s === 'string' && knownBoards.has(s.trim()))
        : [];
      sanitized.push({ ...cat, taskSlugs: filteredTasks, boardSlugs: filteredBoards });
    }
    return validateCategories(sanitized, knownTasks, knownBoards);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function saveCategoriesFor(slug, categories) {
  await fs.mkdir(competitionDir(slug), { recursive: true });
  const file = path.join(competitionDir(slug), 'categories.json');
  const body = JSON.stringify(categories, null, 2) + '\n';
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

function validateParticipantGroups(input) {
  if (!Array.isArray(input)) throw new Error('participant groups must be an array');
  const seen = new Set();
  return input.map((g, idx) => {
    if (!g || typeof g !== 'object') throw new Error(`group #${idx + 1}: must be an object`);
    const slug = typeof g.slug === 'string' ? g.slug.trim() : '';
    const title = typeof g.title === 'string' ? g.title.trim() : '';
    if (!slug) throw new Error(`group #${idx + 1}: slug is required`);
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
      throw new Error(`group #${idx + 1}: slug must be alphanumeric/hyphens`);
    }
    if (slug === 'all' || slug === 'ours') {
      throw new Error(`group slug '${slug}' is reserved`);
    }
    if (!title) throw new Error(`group #${idx + 1}: title is required`);
    if (seen.has(slug)) throw new Error(`duplicate group slug: ${slug}`);
    seen.add(slug);

    const ids = Array.isArray(g.kaggleIds) ? g.kaggleIds : [];
    const cleanIds = [];
    const seenIds = new Set();
    for (const k of ids) {
      if (typeof k !== 'string') continue;
      const t = k.trim();
      if (!t) continue;
      const norm = t.toLowerCase();
      if (seenIds.has(norm)) continue;
      seenIds.add(norm);
      cleanIds.push(t);
    }

    const order = Number.isFinite(Number(g.order)) ? Number(g.order) : 0;
    return { slug, title, kaggleIds: cleanIds, order };
  });
}

async function loadParticipantGroupsFor(slug) {
  const file = path.join(competitionDir(slug), 'participant-groups.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return validateParticipantGroups(parsed);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function saveParticipantGroupsFor(slug, groups) {
  await fs.mkdir(competitionDir(slug), { recursive: true });
  const file = path.join(competitionDir(slug), 'participant-groups.json');
  const body = JSON.stringify(groups, null, 2) + '\n';
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
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
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, file);
}

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
    groupsMeta: [],
    groupsResults: {},
    currentParticipantId: null,
    cycleBoardSlug: null,
    cardBoardSlug: null,
    overallShowBonusPoints: false,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildBonusByNickMap(list) {
  const map = new Map();
  for (const p of list || []) {
    const id = (p && p.kaggleId ? String(p.kaggleId) : '').trim().toLowerCase();
    if (!id) continue;
    const bonus = Number(p.bonusPoints);
    if (!Number.isFinite(bonus) || bonus === 0) continue;
    map.set(id, bonus);
  }
  return map;
}

// Annotate every overall row (and oursOverall) with bonusPoints (0 default).
// `displayMap` is provided for "ours" variants where nicknames have already
// been replaced with "FirstName LastName" — we need to look up by the original
// kaggleId, so we invert the displayMap to map display→kaggleId.
function attachBonusPoints(result, bonusByNick, displayMap) {
  const displayToNick = new Map();
  if (displayMap && displayMap.size) {
    for (const [nick, display] of displayMap) displayToNick.set(display, nick);
  }
  const lookup = (entry) => {
    const nick = (entry.nickname || '').toLowerCase();
    if (bonusByNick.has(nick)) return bonusByNick.get(nick);
    // For "ours" variants the displayed name has been re-written; reverse it.
    const original = displayToNick.get(entry.nickname);
    if (original) return bonusByNick.get(original) || 0;
    return 0;
  };
  for (const e of result.overall || []) {
    e.bonusPoints = lookup(e);
  }
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

function annotateWithDeltas(result, prevCache) {
  const prevTaskPoints = new Map();
  const prevTotalPoints = new Map();
  const prevTaskPlaces = new Map();
  const prevOverallPlaces = new Map();

  for (const slug of Object.keys(prevCache.byTask || {})) {
    const entries = prevCache.byTask[slug]?.entries || [];
    for (const e of entries) {
      if (!e.participantKey) continue;
      prevTaskPoints.set(`${slug}|${e.participantKey}`, e.points);
      if (Number.isFinite(e.place)) prevTaskPlaces.set(`${slug}|${e.participantKey}`, e.place);
    }
  }
  for (const e of prevCache.overall || []) {
    if (!e.participantKey) continue;
    prevTotalPoints.set(e.participantKey, e.totalPoints);
    if (Number.isFinite(e.place)) prevOverallPlaces.set(e.participantKey, e.place);
  }

  for (const slug of Object.keys(result.byTask)) {
    for (const e of result.byTask[slug].entries) {
      const prev = prevTaskPoints.get(`${slug}|${e.participantKey}`);
      e.previousPoints = prev !== undefined ? prev : null;
      const prevPl = prevTaskPlaces.get(`${slug}|${e.participantKey}`);
      e.previousPlace = prevPl !== undefined ? prevPl : null;
    }
  }
  for (const ovr of result.overall) {
    const prev = prevTotalPoints.get(ovr.participantKey);
    ovr.previousTotalPoints = prev !== undefined ? prev : null;
    const prevPl = prevOverallPlaces.get(ovr.participantKey);
    ovr.previousPlace = prevPl !== undefined ? prevPl : null;
    for (const slug of Object.keys(ovr.tasks || {})) {
      const prevP = prevTaskPoints.get(`${slug}|${ovr.participantKey}`);
      ovr.tasks[slug].previousPoints = prevP !== undefined ? prevP : null;
    }
  }
}

export async function refreshAll() {
  if (cache.isRefreshing) {
    console.log('[refresh] skip: still refreshing');
    return;
  }
  cache.isRefreshing = true;
  try {
    cache.competitionsIndex = listActiveCompetitions(getDbHandle());
    for (const comp of cache.competitionsIndex) {
      if (comp.type !== 'kaggle') continue;
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
  const pubDir = publicCsvDirFor(slug);
  const participants = await loadParticipantsFor(slug);

  function pushPrev(task) {
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

  for (const task of tasks) {
    // Source priority: admin-uploaded public CSV → Kaggle CLI fetch.
    const publicCsv = await readPublicFile(pubDir, task.slug).catch(() => null);
    if (publicCsv) {
      try {
        const records = parsePublicCsv(publicCsv.raw, { higherIsBetter: task.higherIsBetter });
        if (!records.length) {
          throw new Error('public CSV is empty');
        }
        const rows = buildPrivateRows({ records, higherIsBetter: task.higherIsBetter, participants });
        taskRows.push({ ...task, updatedAt: publicCsv.updatedAt, rows });
        continue;
      } catch (e) {
        const short = `${task.slug}: public CSV ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[refresh] ${slug}/${task.slug}: ${short}`);
        errors.push({ message: short, at: new Date().toISOString() });
        pushPrev(task);
        continue;
      }
    }

    if (!task.competition) {
      // No source configured for this task — silently use prev or stay empty.
      pushPrev(task);
      continue;
    }

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
      console.error(`[refresh] ${slug}/${task.slug} failed: ${message}`);
      errors.push({ message: short, at: new Date().toISOString() });
      pushPrev(task);
    }
    await sleep(REQUEST_GAP_MS);
  }

  const state = await readCompetitionState(competitionDir(slug));
  const oursSet = buildOursKaggleSet(participants);
  const oursDisplayMap = buildOursDisplayMap(participants);
  const bonusByNick = buildBonusByNickMap(participants);

  const result = buildLeaderboards(taskRows, { variant: 'public' });
  annotateWithDeltas(result, { byTask: compCache.byTask, overall: compCache.overall });
  attachBonusPoints(result, bonusByNick);

  const oursResult = buildLeaderboards(projectTaskRowsToOurs(taskRows, oursSet), { variant: 'public' });
  applyDisplayNames(oursResult, oursDisplayMap);
  annotateWithDeltas(oursResult, { byTask: compCache.oursByTask, overall: compCache.oursOverall });
  attachBonusPoints(oursResult, bonusByNick, oursDisplayMap);

  const privDir = privateDirFor(slug);
  const privateTaskRows = [];
  const privateTaskSlugs = [];
  for (const task of tasks) {
    const file = await readPrivateFile(privDir, task.slug).catch(() => null);
    if (!file) continue;
    let records;
    try {
      records = parsePrivateCsv(file.raw, { higherIsBetter: task.higherIsBetter });
    } catch (e) {
      console.warn(`[private] parse failed for ${slug}/${task.slug}: ${e.message}`);
      continue;
    }
    if (!records.length) continue;
    const rows = buildPrivateRows({ records, higherIsBetter: task.higherIsBetter, participants });
    privateTaskRows.push({
      ...task,
      updatedAt: file.updatedAt,
      rows,
    });
    privateTaskSlugs.push(task.slug);
  }

  const privateResult = buildLeaderboards(privateTaskRows, { variant: 'private' });
  annotateWithDeltas(privateResult, { byTask: compCache.privateByTask, overall: compCache.privateOverall });
  attachBonusPoints(privateResult, bonusByNick);

  const oursPrivateResult = buildLeaderboards(projectTaskRowsToOurs(privateTaskRows, oursSet), { variant: 'private' });
  applyDisplayNames(oursPrivateResult, oursDisplayMap);
  annotateWithDeltas(oursPrivateResult, {
    byTask: compCache.oursPrivateByTask,
    overall: compCache.oursPrivateOverall,
  });
  attachBonusPoints(oursPrivateResult, bonusByNick, oursDisplayMap);

  // Per-participant-group leaderboards: scores re-normalized within each group.
  const groups = await loadParticipantGroupsFor(slug).catch(() => []);
  const prevGroupsResults = compCache.groupsResults || {};
  const groupsResults = {};
  const groupsMeta = [];
  for (const g of groups) {
    const groupSet = new Set(g.kaggleIds.map((s) => s.trim().toLowerCase()).filter(Boolean));
    const pub = buildLeaderboards(projectTaskRowsToOurs(taskRows, groupSet), { variant: 'public' });
    applyDisplayNames(pub, oursDisplayMap);
    annotateWithDeltas(pub, {
      byTask: prevGroupsResults[g.slug]?.byTask || {},
      overall: prevGroupsResults[g.slug]?.overall || [],
    });
    attachBonusPoints(pub, bonusByNick, oursDisplayMap);
    const priv = buildLeaderboards(projectTaskRowsToOurs(privateTaskRows, groupSet), { variant: 'private' });
    applyDisplayNames(priv, oursDisplayMap);
    annotateWithDeltas(priv, {
      byTask: prevGroupsResults[g.slug]?.privateByTask || {},
      overall: prevGroupsResults[g.slug]?.privateOverall || [],
    });
    attachBonusPoints(priv, bonusByNick, oursDisplayMap);
    groupsResults[g.slug] = {
      overall: pub.overall,
      byTask: pub.byTask,
      privateOverall: priv.overall,
      privateByTask: priv.byTask,
    };
    groupsMeta.push({ slug: g.slug, title: g.title, order: g.order ?? 0 });
  }

  const next = {
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
    groupsMeta,
    groupsResults,
    currentParticipantId: state.currentParticipantId,
    cycleBoardSlug: state.cycleBoardSlug,
    cardBoardSlug: state.cardBoardSlug,
    overallShowBonusPoints: state.overallShowBonusPoints === true,
    errors,
  };
  cache.byCompetition.set(slug, next);
  // Persist snapshot to disk (fire-and-forget) so the next backend boot can
  // serve the previous data immediately while a fresh refresh is in flight.
  writeCacheSnapshot(slug, next).catch(() => {});

  console.log(`[refresh] ${slug} OK${errors.length ? ` (${errors.length} task errors)` : ''}`);
}

async function findKaggleStats(slug, kaggleId) {
  if (!kaggleId) return null;
  const compCache = cache.byCompetition.get(slug);
  if (!compCache) return null;
  const key = String(kaggleId).toLowerCase();
  const overall = compCache.overall || [];
  const cardBoardSlug = compCache.cardBoardSlug || null;

  if (!cardBoardSlug) {
    const row = overall.find(
      (r) => (r.nickname || r.participantKey || '').toLowerCase() === key
    );
    if (!row) return null;
    return {
      place: row.place,
      previousPlace: row.previousPlace ?? null,
      totalPoints: row.totalPoints,
      previousTotalPoints: row.previousTotalPoints ?? null,
      nickname: row.nickname,
      teamName: row.teamName,
      tasks: row.tasks,
      sourceLabel: 'Общий ЛБ',
    };
  }

  // Board-scoped: re-rank overall rows by sum of points across the board's tasks.
  const boards = await loadBoardsFor(slug).catch(() => []);
  const board = boards.find((b) => b.slug === cardBoardSlug);
  if (!board) return null;
  const taskSlugs = board.taskSlugs || [];
  const enriched = overall
    .map((r) => {
      const sum = taskSlugs.reduce((s, ts) => s + (r.tasks?.[ts]?.points ?? 0), 0);
      const hasAnyPrev = taskSlugs.some((ts) => r.tasks?.[ts]?.previousPoints != null);
      const prevSum = hasAnyPrev
        ? taskSlugs.reduce((s, ts) => s + (r.tasks?.[ts]?.previousPoints ?? r.tasks?.[ts]?.points ?? 0), 0)
        : null;
      return { ...r, _sum: sum, _prev: prevSum };
    })
    .filter((r) => taskSlugs.some((ts) => r.tasks?.[ts] !== undefined));
  const prevPlaceMap = new Map();
  enriched
    .slice()
    .sort((a, b) => (b._prev ?? -Infinity) - (a._prev ?? -Infinity))
    .forEach((r, i) => {
      if (r._prev != null) prevPlaceMap.set(r.participantKey, i + 1);
    });
  const ranked = enriched
    .sort((a, b) => b._sum - a._sum || (a.nickname || '').localeCompare(b.nickname || ''))
    .map((r, i) => ({ ...r, _place: i + 1 }));
  const row = ranked.find((r) => (r.nickname || r.participantKey || '').toLowerCase() === key);
  if (!row) return null;
  return {
    place: row._place,
    previousPlace: prevPlaceMap.get(row.participantKey) ?? null,
    totalPoints: row._sum,
    previousTotalPoints: row._prev,
    nickname: row.nickname,
    teamName: row.teamName,
    tasks: row.tasks,
    sourceLabel: board.title,
  };
}

function findCompetitionMeta(slug) {
  if (!slug) return null;
  const wanted = String(slug).toLowerCase();
  return cache.competitionsIndex.find((c) => c.slug.toLowerCase() === wanted) || null;
}

function requireCompetition(req, res) {
  const meta = findCompetitionMeta(req.params.competitionSlug);
  if (!meta) {
    res.status(404).json({ error: `Competition '${req.params.competitionSlug}' not found` });
    return null;
  }
  return meta;
}

function ensureKnownSlug(req, res) {
  const slug = String(req.params.competitionSlug || '').toLowerCase();
  const known = cache.competitionsIndex.some((c) => c.slug === slug);
  if (!known) {
    res.status(404).json({ error: `competition '${slug}' not found` });
    return null;
  }
  return slug;
}

export function createApp({ db } = {}) {
  if (!db) throw new Error('createApp({db}) is required');
  _dbForRefresh = db;
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
  const adminMw = requireAdmin({ adminToken: ADMIN_TOKEN });
  const app = express();
  app.set('trust proxy', true);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '50mb' }));
  app.use(loadUser({ db }));
  app.use('/api/auth', createAuthRouter({ db }));
  app.use('/api/me', createMeRouter({ db }));

  const snapshotCache = makeSnapshotCache();
  setOnScoredCallback((slug) => {
    try {
      const fresh = buildNativeLeaderboard(db, slug, 'public');
      snapshotCache.annotate(slug, fresh);
    } catch (e) { console.error('[onScored] cache update failed', e); }
  });

  app.get('/api/health', (_req, res) => {
    const competitions = cache.competitionsIndex.map((c) => {
      const cc = cache.byCompetition.get(c.slug);
      return {
        slug: c.slug,
        updatedAt: cc?.updatedAt || null,
        errors: cc?.errors || [],
      };
    });
    res.json({
      status: 'ok',
      lastSweepAt: cache.lastSweepAt,
      isRefreshing: cache.isRefreshing,
      competitions,
    });
  });

  app.get('/api/competitions', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const list = q ? searchPublicCompetitions(db, q) : listVisibleCompetitions(db);
    res.json({ competitions: list });
  });

  app.get('/api/competitions/:competitionSlug', (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    res.json({ competition: meta });
  });

  app.get('/api/competitions/:competitionSlug/leaderboard', async (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    if (meta.type === 'native') {
      let pub = snapshotCache.get(meta.slug);
      if (!pub) {
        const fresh = buildNativeLeaderboard(db, meta.slug, 'public');
        pub = snapshotCache.annotate(meta.slug, fresh);
      }
      const priv = buildNativeLeaderboard(db, meta.slug, 'private');
      const privateTaskSlugs = Object.keys(priv.byTask).filter((slug) => priv.byTask[slug].entries.length > 0);
      const state = await readCompetitionState(competitionDir(meta.slug));
      const showBonus = state.overallShowBonusPoints === true;
      // snapshotCache.get returns the stored snapshot directly (no clone on
      // read), so we structuredClone before mutating to avoid poisoning the
      // cache. priv is freshly built each request — safe to mutate.
      let pubOverall = pub.overall;
      let privOverall = priv.overall;
      if (showBonus) {
        pubOverall = applyBonusToOverall(structuredClone(pubOverall));
        privOverall = applyBonusToOverall(privOverall);
      }
      res.json({
        updatedAt: new Date().toISOString(),
        tasks: pub.tasks,
        overall: pubOverall,
        byTask: pub.byTask,
        privateOverall: privOverall,
        privateByTask: priv.byTask,
        privateTaskSlugs,
        // SP-3: ours = overall (deferred to SP-4 polish)
        oursOverall: pubOverall,
        oursByTask: pub.byTask,
        oursPrivateOverall: privOverall,
        oursPrivateByTask: priv.byTask,
        overallShowBonusPoints: showBonus,
        errors: [],
      });
      return;
    }
    const cc = cache.byCompetition.get(meta.slug) || emptyCompetitionCache();
    const showBonus = cc.overallShowBonusPoints === true;
    // Always clone overall arrays before mutating: the cache is shared across
    // requests and a sweep may be in flight.
    const cloneOverall = (arr) => structuredClone(arr || []);
    let overall = cloneOverall(cc.overall);
    let privateOverall = cloneOverall(cc.privateOverall);
    let oursOverall = cloneOverall(cc.oursOverall);
    let oursPrivateOverall = cloneOverall(cc.oursPrivateOverall);
    let groupsResults = cc.groupsResults || {};
    if (showBonus) {
      applyBonusToOverall(overall);
      applyBonusToOverall(privateOverall);
      applyBonusToOverall(oursOverall);
      applyBonusToOverall(oursPrivateOverall);
      const cloned = {};
      for (const slug of Object.keys(groupsResults)) {
        const gr = groupsResults[slug] || {};
        cloned[slug] = {
          ...gr,
          overall: applyBonusToOverall(cloneOverall(gr.overall)),
          privateOverall: applyBonusToOverall(cloneOverall(gr.privateOverall)),
        };
      }
      groupsResults = cloned;
    }
    res.json({
      updatedAt: cc.updatedAt,
      tasks: cc.tasks,
      overall,
      privateOverall,
      privateByTask: cc.privateByTask,
      privateTaskSlugs: cc.privateTaskSlugs,
      oursOverall,
      oursByTask: cc.oursByTask,
      oursPrivateOverall,
      oursPrivateByTask: cc.oursPrivateByTask,
      groupsMeta: cc.groupsMeta || [],
      groupsResults,
      overallShowBonusPoints: showBonus,
      errors: cc.errors,
    });
  });

  app.get('/api/competitions/:competitionSlug/tasks/:taskSlug', (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    const cc = cache.byCompetition.get(meta.slug) || emptyCompetitionCache();
    const wanted = String(req.params.taskSlug || '').toLowerCase();
    const findKey = (map) => Object.keys(map).find((k) => k.toLowerCase() === wanted);
    const taskKey = findKey(cc.byTask);
    const privateKey = findKey(cc.privateByTask);
    const oursKey = findKey(cc.oursByTask);
    const oursPrivateKey = findKey(cc.oursPrivateByTask);
    const task = taskKey ? cc.byTask[taskKey] : null;
    const privateTask = privateKey ? cc.privateByTask[privateKey] : null;
    const oursTask = oursKey ? cc.oursByTask[oursKey] : null;
    const oursPrivateTask = oursPrivateKey ? cc.oursPrivateByTask[oursPrivateKey] : null;
    const taskMeta = (cc.tasks || []).find((t) => t.slug.toLowerCase() === wanted);

    if (!task && !privateTask && !taskMeta) {
      res.status(404).json({ error: `Task '${req.params.taskSlug}' not found in '${meta.slug}'` });
      return;
    }

    const fallback = taskMeta
      ? {
          slug: taskMeta.slug,
          title: taskMeta.title,
          competition: taskMeta.competition,
          higherIsBetter: taskMeta.higherIsBetter,
          baselineScorePublic: taskMeta.baselineScorePublic,
          authorScorePublic: taskMeta.authorScorePublic,
          baselineScorePrivate: taskMeta.baselineScorePrivate,
          authorScorePrivate: taskMeta.authorScorePrivate,
          updatedAt: cc.updatedAt,
          entries: [],
        }
      : { ...privateTask, entries: [] };

    const taskErrors = (cc.errors || []).filter((e) =>
      typeof e.message === 'string' && e.message.toLowerCase().startsWith(`${wanted}:`)
    );

    const groupsTask = {};
    const groupsPrivateTask = {};
    for (const g of cc.groupsMeta || []) {
      const gr = (cc.groupsResults || {})[g.slug];
      if (!gr) continue;
      const gKey = Object.keys(gr.byTask || {}).find((k) => k.toLowerCase() === wanted);
      if (gKey) groupsTask[g.slug] = gr.byTask[gKey];
      const gpKey = Object.keys(gr.privateByTask || {}).find((k) => k.toLowerCase() === wanted);
      if (gpKey) groupsPrivateTask[g.slug] = gr.privateByTask[gpKey];
    }

    res.json({
      updatedAt: cc.updatedAt,
      task: task || fallback,
      privateTask,
      oursTask,
      oursPrivateTask,
      groupsMeta: cc.groupsMeta || [],
      groupsTask,
      groupsPrivateTask,
      errors: taskErrors.length ? taskErrors : cc.errors,
    });
  });

  app.get('/api/competitions/:competitionSlug/boards', async (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    try {
      const boards = await loadBoardsFor(meta.slug);
      res.json({ boards });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/competitions/:competitionSlug/categories', async (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    try {
      const categories = await loadCategoriesFor(meta.slug);
      res.json({ categories });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/competitions/:competitionSlug/participants', (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    const cc = cache.byCompetition.get(meta.slug);
    const participants = (cc?.participants || []).map((p) => ({
      id: p.id,
      name: p.name,
      kaggleId: p.kaggleId || null,
    }));
    res.json({
      participants,
      currentId: cc?.currentParticipantId || null,
    });
  });

  app.post('/api/competitions/:competitionSlug/refresh', async (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    if (cache.isRefreshing) {
      res.status(409).json({ error: 'refresh sweep is already running' });
      return;
    }
    await refreshCompetition(meta.slug).catch((e) =>
      console.error(`[refresh ${meta.slug}] FAILED`, e)
    );
    const cc = cache.byCompetition.get(meta.slug);
    res.json({ ok: true, updatedAt: cc?.updatedAt, errors: cc?.errors || [] });
  });

  app.get('/api/competitions/:competitionSlug/card', async (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    const cc = cache.byCompetition.get(meta.slug);
    const current = (cc?.participants || []).find((p) => p.id === cc?.currentParticipantId);
    const kaggleStats = current ? await findKaggleStats(meta.slug, current.kaggleId) : null;
    res.json({
      current: current || null,
      currentId: cc?.currentParticipantId || null,
      kaggleStats,
      cardBoardSlug: cc?.cardBoardSlug || null,
      updatedAt: cc?.updatedAt || null,
    });
  });

  app.post('/api/competitions/:competitionSlug/card', async (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    const { id } = req.body || {};
    const cc = getCompCache(meta.slug);

    if (id === null) {
      cc.currentParticipantId = null;
      await writeCompetitionState(competitionDir(meta.slug), {
        currentParticipantId: null,
        cycleBoardSlug: cc.cycleBoardSlug ?? null,
        cardBoardSlug: cc.cardBoardSlug ?? null,
        overallShowBonusPoints: cc.overallShowBonusPoints === true,
      });
      res.json({ ok: true, currentId: null, current: null });
      return;
    }

    if (typeof id !== 'string') {
      res.status(400).json({ error: 'id must be a string or null' });
      return;
    }

    const participants = await loadParticipantsFor(meta.slug);
    cc.participants = participants;
    const found = participants.find((p) => p.id === id);
    if (!found) {
      res.status(404).json({ error: `participant '${id}' not found in '${meta.slug}'` });
      return;
    }

    cc.currentParticipantId = id;
    await writeCompetitionState(competitionDir(meta.slug), {
      currentParticipantId: id,
      cycleBoardSlug: cc.cycleBoardSlug ?? null,
      cardBoardSlug: cc.cardBoardSlug ?? null,
      overallShowBonusPoints: cc.overallShowBonusPoints === true,
    });
    res.json({ ok: true, currentId: id, current: found });
  });

  app.get('/api/competitions/:competitionSlug/cycle', (req, res) => {
    const meta = requireCompetition(req, res);
    if (!meta) return;
    const cc = cache.byCompetition.get(meta.slug);
    res.json({
      cycleBoardSlug: cc?.cycleBoardSlug ?? null,
      updatedAt: cc?.updatedAt || null,
    });
  });

  app.get('/api/admin/competitions', adminMw, async (_req, res) => {
    res.json({ competitions: listActiveCompetitions(db) });
  });

  app.put('/api/admin/competitions', adminMw, async (req, res) => {
    try {
      const validated = validateCompetitions(req.body?.competitions);
      const enriched = validated.map((c) => {
        return {
          slug: c.slug,
          title: c.title,
          subtitle: c.subtitle ?? null,
          type: c.type,
          visibility: c.visibility,
          visible: c.visible !== false,
          displayOrder: Number.isFinite(c.order) ? c.order : 0,
          theme: c.theme ?? null,
        };
      });
      bulkReplaceCompetitions(db, enriched);
      for (const c of enriched) {
        await fs.mkdir(competitionDir(c.slug), { recursive: true });
      }
      cache.competitionsIndex = listActiveCompetitions(db);
      res.json({ ok: true, competitions: cache.competitionsIndex });
      refreshAll().catch((e) => console.error('[refresh after admin save] FAILED', e));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/admin/competitions', adminMw, async (req, res) => {
    try {
      const next = req.body?.competition;
      if (!next || typeof next !== 'object') {
        res.status(400).json({ error: 'competition object required in body' });
        return;
      }
      const slug = String(next.slug || '').trim().toLowerCase();
      if (getCompetition(db, slug)) {
        res.status(400).json({ error: `slug '${slug}' already exists` });
        return;
      }
      const [validated] = validateCompetitions([next]);
      const created = insertCompetition(db, {
        slug: validated.slug,
        title: validated.title,
        subtitle: validated.subtitle ?? null,
        type: validated.type,
        visibility: validated.visibility,
        visible: validated.visible !== false,
        displayOrder: Number.isFinite(validated.order) ? validated.order : 0,
        theme: validated.theme ?? null,
      });
      await fs.mkdir(competitionDir(created.slug), { recursive: true });
      cache.competitionsIndex = listActiveCompetitions(db);
      res.json({ ok: true, competition: created });
      refreshAll().catch((e) => console.error('[refresh after admin create] FAILED', e));
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/admin/competitions/:competitionSlug', adminMw, async (req, res) => {
    try {
      const slug = String(req.params.competitionSlug || '').toLowerCase();
      const meta = getCompetition(db, slug);
      if (!meta) {
        res.status(404).json({ error: `competition '${slug}' not found` });
        return;
      }
      softDeleteCompetition(db, slug);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dir = competitionDir(slug);
      const deletedDir = path.join(COMPETITIONS_DIR, `${slug}.deleted-${ts}`);
      try {
        await fs.rename(dir, deletedDir);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      cache.competitionsIndex = listActiveCompetitions(db);
      cache.byCompetition.delete(slug);
      res.json({ ok: true, deleted: slug, archivedAs: deletedDir });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/admin/competitions/:competitionSlug/tasks', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const tasks = await loadTasksFor(slug);
      res.json({ tasks });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/tasks', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const tasks = validateTasks(req.body?.tasks);
      await saveTasksFor(slug, tasks);
      res.json({ ok: true, tasks });
      refreshCompetition(slug).catch((e) =>
        console.error(`[refresh after admin tasks save ${slug}] FAILED`, e)
      );
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/admin/competitions/:competitionSlug/boards', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const boards = await loadBoardsFor(slug);
      res.json({ boards });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/boards', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const tasks = await loadTasksFor(slug);
      const known = new Set(tasks.map((t) => t.slug));
      const boards = validateBoards(req.body?.boards, known);
      await saveBoardsFor(slug, boards);
      res.json({ ok: true, boards });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/admin/competitions/:competitionSlug/categories', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const categories = await loadCategoriesFor(slug);
      res.json({ categories });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/admin/competitions/:competitionSlug/participant-groups', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const groups = await loadParticipantGroupsFor(slug);
      res.json({ groups });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/participant-groups', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const groups = validateParticipantGroups(req.body?.groups);
      await saveParticipantGroupsFor(slug, groups);
      res.json({ ok: true, groups });
      refreshCompetition(slug).catch((e) =>
        console.error(`[refresh after participant-groups save ${slug}] FAILED`, e)
      );
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/categories', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const [tasks, boards] = await Promise.all([loadTasksFor(slug), loadBoardsFor(slug)]);
      const knownTasks = new Set(tasks.map((t) => t.slug));
      const knownBoards = new Set(boards.map((b) => b.slug));
      const categories = validateCategories(req.body?.categories, knownTasks, knownBoards);
      await saveCategoriesFor(slug, categories);
      res.json({ ok: true, categories });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/cycle', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    const raw = req.body?.cycleBoardSlug;
    let next = null;
    if (raw === null || raw === undefined || raw === '') {
      next = null;
    } else if (typeof raw === 'string') {
      next = raw;
    } else {
      res.status(400).json({ error: 'cycleBoardSlug must be a string or null' });
      return;
    }
    if (next !== null) {
      try {
        const boards = await loadBoardsFor(slug);
        if (!boards.some((b) => b.slug === next)) {
          res.status(404).json({ error: `board '${next}' not found in '${slug}'` });
          return;
        }
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }
    const cc = getCompCache(slug);
    cc.cycleBoardSlug = next;
    await writeCompetitionState(competitionDir(slug), {
      currentParticipantId: cc.currentParticipantId ?? null,
      cycleBoardSlug: next,
      cardBoardSlug: cc.cardBoardSlug ?? null,
      overallShowBonusPoints: cc.overallShowBonusPoints === true,
    });
    res.json({ ok: true, cycleBoardSlug: next });
  });

  app.put('/api/admin/competitions/:competitionSlug/card-board', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    const raw = req.body?.cardBoardSlug;
    let next = null;
    if (raw === null || raw === undefined || raw === '') {
      next = null;
    } else if (typeof raw === 'string') {
      next = raw;
    } else {
      res.status(400).json({ error: 'cardBoardSlug must be a string or null' });
      return;
    }
    if (next !== null) {
      try {
        const boards = await loadBoardsFor(slug);
        if (!boards.some((b) => b.slug === next)) {
          res.status(404).json({ error: `board '${next}' not found in '${slug}'` });
          return;
        }
      } catch (e) {
        res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }
    const cc = getCompCache(slug);
    cc.cardBoardSlug = next;
    await writeCompetitionState(competitionDir(slug), {
      currentParticipantId: cc.currentParticipantId ?? null,
      cycleBoardSlug: cc.cycleBoardSlug ?? null,
      cardBoardSlug: next,
      overallShowBonusPoints: cc.overallShowBonusPoints === true,
    });
    res.json({ ok: true, cardBoardSlug: next });
  });

  app.get('/api/admin/competitions/:competitionSlug/participants', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const participants = await loadParticipantsFor(slug);
      res.json({ participants });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/participants', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const participants = req.body?.participants;
      if (!Array.isArray(participants)) {
        res.status(400).json({ error: 'participants must be an array' });
        return;
      }
      await saveParticipantsFor(slug, participants);
      res.json({ ok: true, count: participants.length });
      refreshCompetition(slug).catch((e) =>
        console.error(`[refresh after participants save ${slug}] FAILED`, e)
      );
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/private', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const file = await readPrivateFile(privateDirFor(slug), req.params.taskSlug);
      if (!file) { res.json({ exists: false }); return; }
      let count = 0;
      try { count = parsePrivateCsv(file.raw).length; } catch {}
      res.json({ exists: true, csv: file.raw, updatedAt: file.updatedAt, count });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/private', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const tasks = await loadTasksFor(slug);
      const task = tasks.find((t) => t.slug === req.params.taskSlug);
      if (!task) {
        res.status(404).json({ error: `task '${req.params.taskSlug}' not found in '${slug}'` });
        return;
      }
      const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
      const records = parsePrivateCsv(csv, { higherIsBetter: task.higherIsBetter });
      if (!records.length) {
        res.status(400).json({ error: 'no valid rows parsed (need either Kaggle all-submissions columns UserName/IsSelected/PublicScore/PrivateScore or kaggle_id/raw_score)' });
        return;
      }
      await writePrivateFile(privateDirFor(slug), req.params.taskSlug, csv);
      res.json({ ok: true, count: records.length });
      refreshCompetition(slug).catch((e) =>
        console.error(`[refresh after private upload ${slug}/${req.params.taskSlug}] FAILED`, e)
      );
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/private', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      await deletePrivateFile(privateDirFor(slug), req.params.taskSlug);
      res.json({ ok: true });
      refreshCompetition(slug).catch((e) =>
        console.error(`[refresh after private delete ${slug}/${req.params.taskSlug}] FAILED`, e)
      );
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/public-csv', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const file = await readPublicFile(publicCsvDirFor(slug), req.params.taskSlug);
      if (!file) { res.json({ exists: false }); return; }
      let count = 0;
      try { count = parsePublicCsv(file.raw).length; } catch {}
      res.json({ exists: true, csv: file.raw, updatedAt: file.updatedAt, count });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/public-csv', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const tasks = await loadTasksFor(slug);
      const task = tasks.find((t) => t.slug === req.params.taskSlug);
      if (!task) {
        res.status(404).json({ error: `task '${req.params.taskSlug}' not found in '${slug}'` });
        return;
      }
      const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
      const records = parsePublicCsv(csv, { higherIsBetter: task.higherIsBetter });
      if (!records.length) {
        res.status(400).json({ error: 'no valid rows parsed (need columns nickname/raw_score, or Kaggle all-submissions UserName/IsSelected/PublicScore/PrivateScore)' });
        return;
      }
      await writePublicFile(publicCsvDirFor(slug), req.params.taskSlug, csv);
      res.json({ ok: true, count: records.length });
      refreshCompetition(slug).catch((e) =>
        console.error(`[refresh after public-csv upload ${slug}/${req.params.taskSlug}] FAILED`, e)
      );
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/public-csv', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      await deletePublicFile(publicCsvDirFor(slug), req.params.taskSlug);
      res.json({ ok: true });
      refreshCompetition(slug).catch((e) =>
        console.error(`[refresh after public-csv delete ${slug}/${req.params.taskSlug}] FAILED`, e)
      );
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/overall-show-bonus', adminMw, async (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    const raw = req.body?.show;
    if (typeof raw !== 'boolean') {
      res.status(400).json({ error: 'show must be a boolean' });
      return;
    }
    try {
      const current = await readCompetitionState(competitionDir(slug));
      await writeCompetitionState(competitionDir(slug), {
        ...current,
        overallShowBonusPoints: raw,
      });
      const cc = getCompCache(slug);
      cc.overallShowBonusPoints = raw;
      res.json({ ok: true, overallShowBonusPoints: raw });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put('/api/admin/competitions/:competitionSlug/members/:userId/bonus-points', adminMw, (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      res.status(400).json({ error: 'userId must be a positive integer' });
      return;
    }
    const raw = req.body?.bonusPoints;
    const bonus = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(bonus)) {
      res.status(400).json({ error: 'bonusPoints must be a finite number' });
      return;
    }
    try {
      setMemberBonusPoints(db, slug, userId, bonus);
      res.json({ ok: true, bonusPoints: bonus });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/admin/competitions/:competitionSlug/members-bonus', adminMw, (req, res) => {
    const slug = ensureKnownSlug(req, res); if (!slug) return;
    try {
      const members = listMembersWithBonus(db, slug);
      res.json({ members });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.use('/api/admin/competitions/:competitionSlug/native-tasks', adminMw, createNativeTasksAdminRouter({ db }));
  app.use('/api/competitions/:competitionSlug/native-tasks', createNativeTasksPublicRouter({ db }));
  app.use('/api/competitions/:competitionSlug/native-tasks/:taskSlug/submissions', createSubmissionsPublicRouter({ db }));
  app.use('/api/admin/competitions/:competitionSlug/native-tasks/:taskSlug/submissions', adminMw, createSubmissionsAdminRouter({ db }));
  app.use('/api/competitions/:competitionSlug', createMembershipRouter({ db }));

  return app;
}

export async function bootstrapForTests() {
  cache.competitionsIndex = listActiveCompetitions(getDbHandle());
  for (const c of cache.competitionsIndex) {
    if (!cache.byCompetition.has(c.slug)) {
      cache.byCompetition.set(c.slug, emptyCompetitionCache());
    }
  }
}

export async function hydrateFromSnapshots() {
  cache.competitionsIndex = listActiveCompetitions(getDbHandle());
  for (const c of cache.competitionsIndex) {
    const snap = await readCacheSnapshot(c.slug);
    if (!snap) continue;
    const empty = emptyCompetitionCache();
    const merged = { ...empty, ...snap };
    // Bring in non-snapshot stateful bits from disk (state.json, participants).
    try {
      const state = await readCompetitionState(competitionDir(c.slug));
      merged.currentParticipantId = state.currentParticipantId;
      merged.cycleBoardSlug = state.cycleBoardSlug;
      merged.cardBoardSlug = state.cardBoardSlug;
      merged.overallShowBonusPoints = state.overallShowBonusPoints === true;
    } catch {}
    try {
      merged.participants = await loadParticipantsFor(c.slug);
    } catch {}
    cache.byCompetition.set(c.slug, merged);
    console.log(`[snapshot] hydrated ${c.slug} (updatedAt=${merged.updatedAt || '—'})`);
  }
}

export async function reloadIndex() {
  cache.competitionsIndex = listActiveCompetitions(getDbHandle());
}
