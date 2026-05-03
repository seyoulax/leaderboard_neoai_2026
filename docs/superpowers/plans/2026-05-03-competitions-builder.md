# Competitions Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить single-tenant лидерборд (NEOAI 2026) в мульти-тенант: в админке появляется CRUD соревнований, у каждого свой набор задач/бордов/участников, свои публичные страницы и OBS.

**Architecture:** Big-bang refactor. Файлы переезжают в `data/competitions/<slug>/`. Все scoped эндпоинты под `/api/competitions/<slug>/`. Главная `/` — список соревнований, внутри — текущий UX. Миграция NEOAI выполняется автоматически при старте бэка.

**Tech Stack:** Node.js (Express + `node:test` встроенный test runner), React 18, Vite, react-router-dom 6.

**Spec:** `docs/superpowers/specs/2026-05-03-competitions-builder-design.md`

---

## File Structure

### Backend

| File | Status | Responsibility |
| --- | --- | --- |
| `backend/package.json` | modify | Добавить `test` script |
| `backend/src/competitions.js` | **create** | Load/save/validate `competitions.json` |
| `backend/src/migrate.js` | **create** | One-time bootstrap миграция legacy → multi-tenant |
| `backend/src/state.js` | **create** | Per-competition `state.json` (currentParticipantId) |
| `backend/src/index.js` | modify | Refactor cache в `byCompetition`, новые роуты |
| `backend/src/private.js` | модифицировать | Принимать per-competition private dir (минор) |
| `backend/src/leaderboard.js` | unchanged | Логика нормализации не меняется |
| `backend/src/kaggle.js` | unchanged | Kaggle CLI не меняется |
| `backend/tests/competitions.test.js` | **create** | Тесты validateCompetitions |
| `backend/tests/migrate.test.js` | **create** | Тесты миграции (fixtures) |
| `backend/tests/routing.test.js` | **create** | Smoke-тесты scoped эндпоинтов |

### Frontend

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/src/api.js` | modify | Все scoped функции принимают `competitionSlug` |
| `frontend/src/App.jsx` | modify | Routes под `/competitions/<slug>/...`, новые компоненты |
| `frontend/src/CompetitionsListPage.jsx` | **create** | Главная `/` — список карточек |
| `frontend/src/AdminCompetitionsPage.jsx` | **create** | CRUD для `/admin/competitions` |
| `frontend/src/AdminParticipantsPage.jsx` | **create** | JSON paste/upload для участников |
| `frontend/src/legacyRedirects.jsx` | **create** | Маршруты-редиректы для старых URL |

### Docs

| File | Status |
| --- | --- |
| `new_lb/ROUTES.md` | modify |

---

## Phase 1 — Backend foundation

### Task 1: Включить test runner

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Добавить `test` script**

`backend/package.json`:
```json
{
  "name": "neoai-lb-backend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "node --test backend/tests/"
  },
  "dependencies": {
    "adm-zip": "^0.5.16",
    "cors": "^2.8.5",
    "csv-parse": "^5.5.6",
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  }
}
```

(Скрипт запускается из корня репо `new_lb/`. Test runner — встроенный `node:test`, никаких новых зависимостей.)

- [ ] **Step 2: Создать пустой `backend/tests/.gitkeep`**

```bash
mkdir -p backend/tests && touch backend/tests/.gitkeep
```

- [ ] **Step 3: Verify скрипт запускается (даже без тестов)**

Run (из `new_lb/backend/`):
```bash
npm test
```
Expected: `# tests 0 # pass 0 # fail 0` (или аналогичное «no tests found»).

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/tests/.gitkeep
git commit -m "feat(backend): добавить node --test runner"
```

---

### Task 2: `competitions.js` — validate

**Files:**
- Create: `backend/src/competitions.js`
- Create: `backend/tests/competitions.test.js`

- [ ] **Step 1: Failing test для validateCompetitions**

Create `backend/tests/competitions.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCompetitions } from '../src/competitions.js';

test('validateCompetitions: minimal valid entry', () => {
  const out = validateCompetitions([{ slug: 'neoai-2026', title: 'NEOAI 2026' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, 'neoai-2026');
  assert.equal(out[0].title, 'NEOAI 2026');
  assert.equal(out[0].order, 0);
  assert.equal(out[0].visible, true);
  assert.equal(out[0].subtitle, undefined);
});

test('validateCompetitions: rejects empty slug', () => {
  assert.throws(
    () => validateCompetitions([{ slug: '', title: 'x' }]),
    /slug/i
  );
});

test('validateCompetitions: rejects bad slug pattern', () => {
  assert.throws(
    () => validateCompetitions([{ slug: 'NEOAI 2026', title: 'x' }]),
    /slug/i
  );
});

test('validateCompetitions: rejects deny-listed slug', () => {
  assert.throws(
    () => validateCompetitions([{ slug: 'admin', title: 'x' }]),
    /reserved/i
  );
});

test('validateCompetitions: rejects duplicate slug', () => {
  assert.throws(
    () => validateCompetitions([
      { slug: 'a', title: 'A' },
      { slug: 'a', title: 'B' },
    ]),
    /duplicate/i
  );
});

test('validateCompetitions: rejects missing title', () => {
  assert.throws(
    () => validateCompetitions([{ slug: 'a' }]),
    /title/i
  );
});

test('validateCompetitions: defaults order=0 and visible=true', () => {
  const out = validateCompetitions([{ slug: 'a', title: 'A' }]);
  assert.equal(out[0].order, 0);
  assert.equal(out[0].visible, true);
});

test('validateCompetitions: keeps subtitle when provided', () => {
  const out = validateCompetitions([{ slug: 'a', title: 'A', subtitle: 's' }]);
  assert.equal(out[0].subtitle, 's');
});
```

- [ ] **Step 2: Run — должны упасть (нет файла competitions.js)**

Run: `cd backend && npm test`
Expected: ERR_MODULE_NOT_FOUND для `../src/competitions.js`.

- [ ] **Step 3: Создать `competitions.js` с валидатором**

Create `backend/src/competitions.js`:
```javascript
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
    result.order = Number.isFinite(Number(c.order)) ? Number(c.order) : 0;
    result.visible = c.visible !== false;
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
  await fs.writeFile(filePath, body, 'utf8');
  return validated;
}
```

- [ ] **Step 4: Run — все тесты pass**

Run: `cd backend && npm test`
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/competitions.js backend/tests/competitions.test.js
git commit -m "feat(backend): валидация competitions.json"
```

---

### Task 3: `migrate.js` — bootstrap миграция

**Files:**
- Create: `backend/src/migrate.js`
- Create: `backend/tests/migrate.test.js`

- [ ] **Step 1: Failing test для миграции**

Create `backend/tests/migrate.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrate } from '../src/migrate.js';

async function makeTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'neoai-migrate-'));
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

test('migrate: no-op when competitions.json already exists', async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, 'competitions.json'), '[]');
  await fs.writeFile(path.join(dir, 'tasks.json'), '[{"slug":"x","title":"x","competition":"x"}]');

  const result = await migrate(dir);

  assert.equal(result.migrated, false);
  assert.equal(await exists(path.join(dir, 'tasks.json')), true);
});

test('migrate: no-op when neither competitions.json nor legacy exists', async () => {
  const dir = await makeTempDir();
  const result = await migrate(dir);
  assert.equal(result.migrated, false);
  assert.equal(await exists(path.join(dir, 'competitions.json')), true);
  const indexRaw = await fs.readFile(path.join(dir, 'competitions.json'), 'utf8');
  assert.deepEqual(JSON.parse(indexRaw), []);
});

test('migrate: legacy → competitions/neoai-2026/', async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, 'tasks.json'), JSON.stringify([{ slug: 't1', title: 'T1', competition: 'kaggle-1' }]));
  await fs.writeFile(path.join(dir, 'boards.json'), JSON.stringify([{ slug: 'b1', title: 'B1', taskSlugs: ['t1'] }]));
  await fs.writeFile(path.join(dir, 'participants.json'), JSON.stringify([{ id: 'p1', name: 'Иванов Иван', kaggleId: 'iv1' }]));
  await fs.mkdir(path.join(dir, 'private'), { recursive: true });
  await fs.writeFile(path.join(dir, 'private', 't1.csv'), 'kaggle_id,raw_score\niv1,0.9');

  const result = await migrate(dir);

  assert.equal(result.migrated, true);
  assert.equal(result.competitionSlug, 'neoai-2026');
  // legacy moved into competitions/neoai-2026/
  assert.equal(await exists(path.join(dir, 'competitions/neoai-2026/tasks.json')), true);
  assert.equal(await exists(path.join(dir, 'competitions/neoai-2026/boards.json')), true);
  assert.equal(await exists(path.join(dir, 'competitions/neoai-2026/participants.json')), true);
  // private moved into private/neoai-2026/
  assert.equal(await exists(path.join(dir, 'private/neoai-2026/t1.csv')), true);
  // legacy gone from root
  assert.equal(await exists(path.join(dir, 'tasks.json')), false);
  assert.equal(await exists(path.join(dir, 'boards.json')), false);
  assert.equal(await exists(path.join(dir, 'participants.json')), false);
  // backup created
  const subs = await fs.readdir(dir);
  assert.ok(subs.some((s) => s.startsWith('_legacy-backup-')), `expected _legacy-backup-* in ${subs.join(',')}`);
  // index has neoai-2026
  const idx = JSON.parse(await fs.readFile(path.join(dir, 'competitions.json'), 'utf8'));
  assert.equal(idx.length, 1);
  assert.equal(idx[0].slug, 'neoai-2026');
  assert.equal(idx[0].title, 'NEOAI 2026');
});

test('migrate: idempotent — повторный запуск ничего не делает', async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, 'tasks.json'), '[]');
  await fs.writeFile(path.join(dir, 'boards.json'), '[]');
  await fs.writeFile(path.join(dir, 'participants.json'), '[]');

  const r1 = await migrate(dir);
  const r2 = await migrate(dir);

  assert.equal(r1.migrated, true);
  assert.equal(r2.migrated, false);
});
```

- [ ] **Step 2: Run — упадёт (нет migrate.js)**

Run: `cd backend && npm test -- backend/tests/migrate.test.js`
Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Создать `migrate.js`**

Create `backend/src/migrate.js`:
```javascript
import fs from 'node:fs/promises';
import path from 'node:path';
import { saveCompetitions } from './competitions.js';

const LEGACY_FILES = ['tasks.json', 'boards.json', 'participants.json'];
const NEOAI_SLUG = 'neoai-2026';
const NEOAI_TITLE = 'NEOAI 2026';
const NEOAI_SUBTITLE = 'Northern Eurasia Olympiad in Artificial Intelligence 2026';

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function moveIfExists(src, dst) {
  if (!(await exists(src))) return false;
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  return true;
}

async function copyIfExists(src, dst) {
  if (!(await exists(src))) return false;
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  return true;
}

export async function migrate(dataDir) {
  const indexPath = path.join(dataDir, 'competitions.json');

  // Already migrated — bail.
  if (await exists(indexPath)) {
    return { migrated: false, reason: 'competitions.json already exists' };
  }

  // Detect legacy.
  const hasLegacy = (await Promise.all(
    LEGACY_FILES.map((f) => exists(path.join(dataDir, f)))
  )).some(Boolean);

  if (!hasLegacy) {
    // Fresh deploy — create empty index.
    await fs.mkdir(dataDir, { recursive: true });
    await saveCompetitions(indexPath, []);
    return { migrated: false, reason: 'no legacy files; created empty index' };
  }

  // Backup snapshot first.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, `_legacy-backup-${ts}`);
  await fs.mkdir(backupDir, { recursive: true });
  for (const f of LEGACY_FILES) {
    await copyIfExists(path.join(dataDir, f), path.join(backupDir, f));
  }
  // Backup whole private/ dir if exists.
  const legacyPrivateDir = path.join(dataDir, 'private');
  if (await exists(legacyPrivateDir)) {
    const entries = await fs.readdir(legacyPrivateDir);
    for (const e of entries) {
      const src = path.join(legacyPrivateDir, e);
      const stat = await fs.stat(src);
      if (stat.isFile()) {
        await fs.copyFile(src, path.join(backupDir, e));
      }
    }
  }

  // Move legacy files into competitions/<slug>/.
  const compDir = path.join(dataDir, 'competitions', NEOAI_SLUG);
  await fs.mkdir(compDir, { recursive: true });
  for (const f of LEGACY_FILES) {
    await moveIfExists(path.join(dataDir, f), path.join(compDir, f));
  }

  // Move private/*.csv → private/<slug>/*.csv.
  if (await exists(legacyPrivateDir)) {
    const entries = await fs.readdir(legacyPrivateDir);
    const newPrivateDir = path.join(legacyPrivateDir, NEOAI_SLUG);
    for (const e of entries) {
      const src = path.join(legacyPrivateDir, e);
      const stat = await fs.stat(src);
      if (stat.isFile() && e.endsWith('.csv')) {
        await fs.mkdir(newPrivateDir, { recursive: true });
        await fs.rename(src, path.join(newPrivateDir, e));
      }
    }
  }

  // Write index.
  await saveCompetitions(indexPath, [{
    slug: NEOAI_SLUG,
    title: NEOAI_TITLE,
    subtitle: NEOAI_SUBTITLE,
    order: 0,
    visible: true,
  }]);

  return { migrated: true, competitionSlug: NEOAI_SLUG, backupDir };
}
```

- [ ] **Step 4: Run — все тесты pass**

Run: `cd backend && npm test`
Expected: все тесты (включая competitions.test.js) проходят.

- [ ] **Step 5: Commit**

```bash
git add backend/src/migrate.js backend/tests/migrate.test.js
git commit -m "feat(backend): автоматическая миграция legacy → multi-tenant"
```

---

### Task 4: `state.js` — per-competition state.json

**Files:**
- Create: `backend/src/state.js`

- [ ] **Step 1: Создать `state.js`**

Create `backend/src/state.js`:
```javascript
import fs from 'node:fs/promises';
import path from 'node:path';

export async function readCompetitionState(competitionDir) {
  const file = path.join(competitionDir, 'state.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      currentParticipantId: typeof parsed?.currentParticipantId === 'string'
        ? parsed.currentParticipantId
        : null,
    };
  } catch (e) {
    if (e.code === 'ENOENT') return { currentParticipantId: null };
    throw e;
  }
}

export async function writeCompetitionState(competitionDir, state) {
  await fs.mkdir(competitionDir, { recursive: true });
  const file = path.join(competitionDir, 'state.json');
  const body = JSON.stringify({
    currentParticipantId: state.currentParticipantId ?? null,
  }, null, 2) + '\n';
  await fs.writeFile(file, body, 'utf8');
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/state.js
git commit -m "feat(backend): per-competition state.json (currentParticipantId)"
```

---

## Phase 2 — Backend cache & refresh

### Task 5: Refactor cache в `byCompetition` Map + bootstrap

**Files:**
- Modify: `backend/src/index.js` (большой рефакторинг)

Этот таск меняет основу — лучше делать полностью за один проход. Промежуточные коммиты в подшагах.

- [ ] **Step 1: Импорты и пути**

В верхней части `backend/src/index.js`, сразу после существующих импортов dotenv:
```javascript
import { loadCompetitions, saveCompetitions, validateCompetitions } from './competitions.js';
import { migrate } from './migrate.js';
import { readCompetitionState, writeCompetitionState } from './state.js';
```

Заменить блок констант путей:
```javascript
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
```

Удалить старые `TASKS_FILE`, `BOARDS_FILE`, `PARTICIPANTS_FILE`, `PRIVATE_DIR`.

- [ ] **Step 2: Заменить loadTasks/saveTasks/loadBoards/loadParticipants на per-slug версии**

Удалить существующие функции `loadTasks`, `saveTasks`, `loadBoards`, `saveBoards`, `loadParticipants` (они принимают глобальный путь).

Добавить вместо них:
```javascript
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
```

(`validateTasks` и `validateBoards` уже определены в `index.js` — оставляем как есть.)

- [ ] **Step 3: Заменить cache на byCompetition Map**

Удалить старое:
```javascript
let cache = {
  updatedAt: null,
  overall: [],
  byTask: {},
  ...
};
```

Заменить на:
```javascript
let cache = {
  isRefreshing: false,
  lastSweepAt: null,
  competitionsIndex: [],     // [{slug, title, subtitle, order, visible}, ...]
  byCompetition: new Map(),  // slug -> CompetitionCache
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
```

- [ ] **Step 4: Refactor refreshCache → refreshAll + refreshCompetition**

Удалить существующий `refreshCache` целиком. Добавить:
```javascript
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

  // Per-competition participants and state.
  const participants = await loadParticipantsFor(slug);
  const state = await readCompetitionState(competitionDir(slug));
  const oursSet = buildOursKaggleSet(participants);
  const oursDisplayMap = buildOursDisplayMap(participants);

  const result = buildLeaderboards(taskRows);
  annotateWithDeltas(result, { byTask: compCache.byTask, overall: compCache.overall });

  const oursResult = buildLeaderboards(projectTaskRowsToOurs(taskRows, oursSet));
  applyDisplayNames(oursResult, oursDisplayMap);
  annotateWithDeltas(oursResult, { byTask: compCache.oursByTask, overall: compCache.oursOverall });

  // Private (per-competition private dir).
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

  // Persist new cache.
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
```

`buildOursKaggleSet`, `buildOursDisplayMap`, `applyDisplayNames`, `projectTaskRowsToOurs`, `filterRowsByOurs`, `annotateWithDeltas`, `sleep` — оставляем как есть, они уже определены в файле.

- [ ] **Step 5: Refactor `findKaggleStats` для per-competition**

Заменить существующий `findKaggleStats`:
```javascript
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
```

- [ ] **Step 6: Bootstrap при старте**

В обработчике `app.listen`, заменить:
```javascript
app.listen(PORT, async () => {
  console.log(`Backend started on http://localhost:${PORT}`);
  participants = await loadParticipants();
  if (participants.length > 0) {
    currentParticipantId = participants[0].id;
  }
  await refreshCache();
  setInterval(refreshCache, REFRESH_MS);
});
```

На:
```javascript
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
```

Удалить глобальные `let participants = []` и `let currentParticipantId = null` — они больше не нужны.

- [ ] **Step 7: Verify сборка/синтаксис**

Run: `cd backend && node --check src/index.js`
Expected: OK.

(API эндпоинты ещё не переписаны — health check и старые роуты пока сломаны. Это нормально, чиним в следующих тасках.)

- [ ] **Step 8: Commit**

```bash
git add backend/src/index.js
git commit -m "refactor(backend): cache в byCompetition Map, refreshAll/refreshCompetition"
```

---

## Phase 3 — Backend public API

### Task 6: Public scoped эндпоинты

**Files:**
- Modify: `backend/src/index.js`

- [ ] **Step 1: Удалить старые публичные эндпоинты**

Удалить целиком (ниже в файле, там где роуты):
- `app.get('/api/health', ...)`
- `app.get('/api/tasks', ...)`
- `app.get('/api/leaderboard', ...)`
- `app.get('/api/tasks/:slug', ...)`
- `app.post('/api/refresh', ...)`
- `app.get('/api/participants', ...)`
- `app.get('/api/card', ...)`
- `app.post('/api/card', ...)`
- `app.get('/api/boards', ...)`

(Не трогать админские endpoint'ы — они в следующем таске.)

- [ ] **Step 2: Helper для разрешения slug**

Сразу после `requireAdmin`-helpers, добавить:
```javascript
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
```

- [ ] **Step 3: Глобальные публичные эндпоинты**

Добавить:
```javascript
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

app.get('/api/competitions', (_req, res) => {
  const visible = cache.competitionsIndex
    .filter((c) => c.visible)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  res.json({ competitions: visible });
});
```

- [ ] **Step 4: Per-competition public endpoints**

Добавить:
```javascript
app.get('/api/competitions/:competitionSlug', (req, res) => {
  const meta = requireCompetition(req, res);
  if (!meta) return;
  res.json({ competition: meta });
});

app.get('/api/competitions/:competitionSlug/leaderboard', (req, res) => {
  const meta = requireCompetition(req, res);
  if (!meta) return;
  const cc = cache.byCompetition.get(meta.slug) || emptyCompetitionCache();
  res.json({
    updatedAt: cc.updatedAt,
    tasks: cc.tasks,
    overall: cc.overall,
    privateOverall: cc.privateOverall,
    privateByTask: cc.privateByTask,
    privateTaskSlugs: cc.privateTaskSlugs,
    oursOverall: cc.oursOverall,
    oursByTask: cc.oursByTask,
    oursPrivateOverall: cc.oursPrivateOverall,
    oursPrivateByTask: cc.oursPrivateByTask,
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
        baselineScore: taskMeta.baselineScore,
        authorScore: taskMeta.authorScore,
        updatedAt: cc.updatedAt,
        entries: [],
      }
    : { ...privateTask, entries: [] };

  const taskErrors = (cc.errors || []).filter((e) =>
    typeof e.message === 'string' && e.message.toLowerCase().startsWith(`${wanted}:`)
  );

  res.json({
    updatedAt: cc.updatedAt,
    task: task || fallback,
    privateTask,
    oursTask,
    oursPrivateTask,
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

app.get('/api/competitions/:competitionSlug/card', (req, res) => {
  const meta = requireCompetition(req, res);
  if (!meta) return;
  const cc = cache.byCompetition.get(meta.slug);
  const current = (cc?.participants || []).find((p) => p.id === cc?.currentParticipantId);
  const kaggleStats = current ? findKaggleStats(meta.slug, current.kaggleId) : null;
  res.json({
    current: current || null,
    currentId: cc?.currentParticipantId || null,
    kaggleStats,
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
    await writeCompetitionState(competitionDir(meta.slug), { currentParticipantId: null });
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
  await writeCompetitionState(competitionDir(meta.slug), { currentParticipantId: id });
  res.json({ ok: true, currentId: id, current: found });
});
```

- [ ] **Step 5: Verify**

Run: `cd backend && node --check src/index.js`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add backend/src/index.js
git commit -m "feat(backend): public scoped эндпоинты под /api/competitions/<slug>/"
```

---

### Task 7: Admin scoped эндпоинты

**Files:**
- Modify: `backend/src/index.js`

- [ ] **Step 1: Удалить старые admin эндпоинты**

Удалить:
- `app.get('/api/admin/tasks', ...)`
- `app.put('/api/admin/tasks', ...)`
- `app.get('/api/admin/boards', ...)`
- `app.put('/api/admin/boards', ...)`
- `app.get('/api/admin/tasks/:slug/private', ...)`
- `app.put('/api/admin/tasks/:slug/private', ...)`
- `app.delete('/api/admin/tasks/:slug/private', ...)`

- [ ] **Step 2: Admin для competitions**

Добавить:
```javascript
app.get('/api/admin/competitions', requireAdmin, async (_req, res) => {
  try {
    const list = await loadCompetitions(COMPETITIONS_FILE);
    res.json({ competitions: list });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/admin/competitions', requireAdmin, async (req, res) => {
  try {
    const validated = validateCompetitions(req.body?.competitions);
    await saveCompetitions(COMPETITIONS_FILE, validated);
    // Ensure dirs exist for all listed slugs.
    for (const c of validated) {
      await fs.mkdir(competitionDir(c.slug), { recursive: true });
    }
    cache.competitionsIndex = validated;
    res.json({ ok: true, competitions: validated });
    refreshAll().catch((e) => console.error('[refresh after admin save] FAILED', e));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/admin/competitions', requireAdmin, async (req, res) => {
  try {
    const next = req.body?.competition;
    if (!next || typeof next !== 'object') {
      res.status(400).json({ error: 'competition object required in body' });
      return;
    }
    const list = await loadCompetitions(COMPETITIONS_FILE);
    if (list.some((c) => c.slug === String(next.slug || '').trim().toLowerCase())) {
      res.status(400).json({ error: `slug '${next.slug}' already exists` });
      return;
    }
    const validated = validateCompetitions([...list, next]);
    await saveCompetitions(COMPETITIONS_FILE, validated);
    const created = validated[validated.length - 1];
    await fs.mkdir(competitionDir(created.slug), { recursive: true });
    cache.competitionsIndex = validated;
    res.json({ ok: true, competition: created });
    refreshAll().catch((e) => console.error('[refresh after admin create] FAILED', e));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/admin/competitions/:competitionSlug', requireAdmin, async (req, res) => {
  try {
    const slug = String(req.params.competitionSlug || '').toLowerCase();
    const list = await loadCompetitions(COMPETITIONS_FILE);
    const idx = list.findIndex((c) => c.slug === slug);
    if (idx < 0) {
      res.status(404).json({ error: `competition '${slug}' not found` });
      return;
    }
    const remaining = list.filter((c) => c.slug !== slug);
    await saveCompetitions(COMPETITIONS_FILE, remaining);
    // Soft-delete dir: rename to <slug>.deleted-<ts>.
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = competitionDir(slug);
    const deletedDir = path.join(COMPETITIONS_DIR, `${slug}.deleted-${ts}`);
    try {
      await fs.rename(dir, deletedDir);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    cache.competitionsIndex = remaining;
    cache.byCompetition.delete(slug);
    res.json({ ok: true, deleted: slug, archivedAs: deletedDir });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
```

- [ ] **Step 3: Admin для tasks/boards/participants per-competition**

Добавить:
```javascript
function ensureKnownSlug(req, res) {
  const slug = String(req.params.competitionSlug || '').toLowerCase();
  const known = cache.competitionsIndex.some((c) => c.slug === slug);
  if (!known) {
    res.status(404).json({ error: `competition '${slug}' not found` });
    return null;
  }
  return slug;
}

app.get('/api/admin/competitions/:competitionSlug/tasks', requireAdmin, async (req, res) => {
  const slug = ensureKnownSlug(req, res); if (!slug) return;
  try {
    const tasks = await loadTasksFor(slug);
    res.json({ tasks });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/admin/competitions/:competitionSlug/tasks', requireAdmin, async (req, res) => {
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

app.get('/api/admin/competitions/:competitionSlug/boards', requireAdmin, async (req, res) => {
  const slug = ensureKnownSlug(req, res); if (!slug) return;
  try {
    const boards = await loadBoardsFor(slug);
    res.json({ boards });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/admin/competitions/:competitionSlug/boards', requireAdmin, async (req, res) => {
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

app.get('/api/admin/competitions/:competitionSlug/participants', requireAdmin, async (req, res) => {
  const slug = ensureKnownSlug(req, res); if (!slug) return;
  try {
    const participants = await loadParticipantsFor(slug);
    res.json({ participants });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.put('/api/admin/competitions/:competitionSlug/participants', requireAdmin, async (req, res) => {
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

app.get('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/private', requireAdmin, async (req, res) => {
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

app.put('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/private', requireAdmin, async (req, res) => {
  const slug = ensureKnownSlug(req, res); if (!slug) return;
  try {
    const tasks = await loadTasksFor(slug);
    if (!tasks.find((t) => t.slug === req.params.taskSlug)) {
      res.status(404).json({ error: `task '${req.params.taskSlug}' not found in '${slug}'` });
      return;
    }
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    const records = parsePrivateCsv(csv);
    if (!records.length) {
      res.status(400).json({ error: 'no valid rows parsed (need columns kaggle_id and raw_score)' });
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

app.delete('/api/admin/competitions/:competitionSlug/tasks/:taskSlug/private', requireAdmin, async (req, res) => {
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
```

- [ ] **Step 4: Verify**

Run: `cd backend && node --check src/index.js`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add backend/src/index.js
git commit -m "feat(backend): admin scoped эндпоинты для competitions/tasks/boards/participants/private"
```

---

### Task 8: Routing smoke-тест

**Files:**
- Create: `backend/tests/routing.test.js`

- [ ] **Step 1: Failing routing test**

Create `backend/tests/routing.test.js`:
```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

let app;
let server;
let baseUrl;
let dataDir;

async function fetchJson(path, opts = {}) {
  const url = baseUrl + path;
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neoai-rt-'));
  await fs.mkdir(path.join(dataDir, 'competitions/test-comp'), { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'competitions.json'),
    JSON.stringify([{ slug: 'test-comp', title: 'Test', order: 0, visible: true }], null, 2)
  );
  await fs.writeFile(path.join(dataDir, 'competitions/test-comp/tasks.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'competitions/test-comp/boards.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'competitions/test-comp/participants.json'), '[]');

  process.env.DATA_DIR = dataDir;
  process.env.PORT = '0';
  process.env.REFRESH_MS = '999999999';   // не дёргаем kaggle в тесте
  process.env.KAGGLE_CMD = '/bin/false';  // если всё-таки дёрнется — фейлится молча
  process.env.REQUEST_GAP_MS = '0';

  // Импортируем фабрику приложения. См. Task 8 step 2 — нужен small split в index.js.
  const mod = await import('../src/app.js');
  app = mod.createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  // Прогрузить конфиг + кеш вручную (refreshAll сейчас зовёт kaggle — пропустим).
  await mod.bootstrapForTests();
});

after(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('GET /api/health returns 200 with competitions array', async () => {
  const { status, body } = await fetchJson('/api/health');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.competitions));
});

test('GET /api/competitions returns visible list', async () => {
  const { status, body } = await fetchJson('/api/competitions');
  assert.equal(status, 200);
  assert.equal(body.competitions.length, 1);
  assert.equal(body.competitions[0].slug, 'test-comp');
});

test('GET /api/competitions/test-comp returns meta', async () => {
  const { status, body } = await fetchJson('/api/competitions/test-comp');
  assert.equal(status, 200);
  assert.equal(body.competition.slug, 'test-comp');
});

test('GET /api/competitions/test-comp/leaderboard 200 (empty)', async () => {
  const { status, body } = await fetchJson('/api/competitions/test-comp/leaderboard');
  assert.equal(status, 200);
  assert.deepEqual(body.overall, []);
});

test('GET /api/competitions/wrong/leaderboard 404', async () => {
  const { status, body } = await fetchJson('/api/competitions/wrong/leaderboard');
  assert.equal(status, 404);
  assert.match(body.error, /not found/i);
});

test('GET /api/competitions hides invisible', async () => {
  await fs.writeFile(
    path.join(dataDir, 'competitions.json'),
    JSON.stringify([
      { slug: 'test-comp', title: 'Test', order: 0, visible: true },
      { slug: 'hidden', title: 'Hidden', order: 1, visible: false },
    ], null, 2)
  );
  // reload index manually
  const { reloadIndex } = await import('../src/app.js');
  await reloadIndex();
  const { body } = await fetchJson('/api/competitions');
  assert.equal(body.competitions.length, 1);
  assert.equal(body.competitions[0].slug, 'test-comp');
});
```

- [ ] **Step 2: Split index.js → app.js (фабрика приложения для тестов)**

Этот split нужен, чтобы можно было создать app без вызова `app.listen` и `setInterval`. Прагматично:

В `backend/src/index.js`:
1. Извлечь весь код, который строит `app` (от `const app = express()` до последнего route handler), в новый файл `backend/src/app.js`.
2. В `app.js` экспортировать `createApp()` (возвращает Express app), `bootstrapForTests()` (загружает competitionsIndex без kaggle), `reloadIndex()` (перезагружает индекс вручную).
3. В `index.js` оставить только запуск: импорт `createApp`, миграция, listen, setInterval.

Create `backend/src/app.js`:
```javascript
// Этот файл — рефакторинг index.js. Полное тело (cache, helpers, validators,
// все handlers) переезжает сюда. createApp() создаёт и возвращает app.
// index.js становится тонкой обёрткой.
//
// Структура:
//   - все импорты (как в index.js)
//   - все валидаторы (validateTasks, validateBoards) и helpers (sleep, buildOursKaggleSet, ...)
//   - cache (let-переменная module-scope)
//   - load*For/save*For
//   - refreshAll/refreshCompetition
//   - export function createApp()
//   - export async function bootstrapForTests() — загружает competitionsIndex и инициализирует пустые compCache, без kaggle
//   - export async function reloadIndex() — для тестов
//
// Полностью эквивалентен текущему index.js (после Tasks 5/6/7), но без app.listen/setInterval/migrate-вызова в нижней части.
```

В коде это означает: переместить всё ниже dotenv + констант (включая `let cache`, validators, helpers, route handlers) в `app.js`, обернуть подключение routes в:
```javascript
export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json());
  // … все app.get/post/put/delete как сейчас …
  return app;
}

export async function bootstrapForTests() {
  cache.competitionsIndex = await loadCompetitions(COMPETITIONS_FILE);
  for (const c of cache.competitionsIndex) {
    if (!cache.byCompetition.has(c.slug)) {
      cache.byCompetition.set(c.slug, emptyCompetitionCache());
    }
  }
}

export async function reloadIndex() {
  cache.competitionsIndex = await loadCompetitions(COMPETITIONS_FILE);
}
```

`backend/src/index.js` после рефакторинга:
```javascript
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { migrate } from './migrate.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3001);
const REFRESH_MS = Number(process.env.REFRESH_MS || 60000);
const DATA_DIR = path.resolve(__dirname, '..', process.env.DATA_DIR || './data');

const app = createApp();

app.listen(PORT, async () => {
  console.log(`Backend started on http://localhost:${PORT}`);
  try {
    const result = await migrate(DATA_DIR);
    if (result.migrated) {
      console.log(`[migrate] OK: ${result.competitionSlug}`);
    }
  } catch (e) {
    console.error('[migrate] FAILED', e);
  }
  const { refreshAll } = await import('./app.js');
  await refreshAll();
  setInterval(refreshAll, REFRESH_MS);
});
```

(`refreshAll` тоже нужно экспортировать из `app.js`.)

- [ ] **Step 3: Run тесты**

Run: `cd backend && npm test`
Expected: все тесты pass (competitions, migrate, routing).

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.js backend/src/index.js backend/tests/routing.test.js
git commit -m "test(backend): smoke-тест scoped routing + split index.js → app.js"
```

---

## Phase 4 — Frontend foundation

### Task 9: Update `api.js` для новых эндпоинтов

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Заменить функции на scoped**

Удалить старые `getOverallLeaderboard`, `getTaskLeaderboard`, `getTasks`, `getBoards`, `getParticipants`, `getCurrentCard`, `setCurrentCard`, `getAdminTasks`, `saveAdminTasks`, `getAdminPrivate`, `uploadAdminPrivate`, `deleteAdminPrivate`, `getAdminBoards`, `saveAdminBoards`.

Заменить на:
```javascript
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001/api';

// ---------- Public, unscoped ----------

export async function getCompetitions() {
  const res = await fetch(`${API_BASE}/competitions`);
  if (!res.ok) throw new Error(`Failed to fetch competitions: ${res.status}`);
  return res.json();
}

// ---------- Public, scoped to competition ----------

function compBase(slug) {
  return `${API_BASE}/competitions/${encodeURIComponent(slug)}`;
}

export async function getCompetition(slug) {
  const res = await fetch(compBase(slug));
  if (!res.ok) throw new Error(`Failed to fetch competition '${slug}': ${res.status}`);
  return res.json();
}

export async function getOverallLeaderboard(slug) {
  const res = await fetch(`${compBase(slug)}/leaderboard`);
  if (!res.ok) throw new Error(`Failed to fetch leaderboard '${slug}': ${res.status}`);
  return res.json();
}

export async function getTaskLeaderboard(slug, taskSlug) {
  const res = await fetch(`${compBase(slug)}/tasks/${encodeURIComponent(taskSlug)}`);
  if (!res.ok) throw new Error(`Failed to fetch task '${slug}/${taskSlug}': ${res.status}`);
  return res.json();
}

export async function getBoards(slug) {
  const res = await fetch(`${compBase(slug)}/boards`);
  if (!res.ok) throw new Error(`Failed to fetch boards '${slug}': ${res.status}`);
  return res.json();
}

export async function getParticipants(slug) {
  const res = await fetch(`${compBase(slug)}/participants`);
  if (!res.ok) throw new Error(`Failed to fetch participants '${slug}': ${res.status}`);
  return res.json();
}

export async function getCurrentCard(slug) {
  const res = await fetch(`${compBase(slug)}/card`);
  if (!res.ok) throw new Error(`Failed to fetch card '${slug}': ${res.status}`);
  return res.json();
}

export async function setCurrentCard(slug, id) {
  const res = await fetch(`${compBase(slug)}/card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`Failed to set current card '${slug}': ${res.status}`);
  return res.json();
}

// ---------- Admin token (unchanged) ----------

const ADMIN_TOKEN_KEY = 'neoai_admin_token';

export function getAdminToken() {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; }
}
export function setAdminToken(token) {
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}
export class AdminAuthError extends Error {
  constructor(message = 'unauthorized') {
    super(message); this.name = 'AdminAuthError';
  }
}

async function adminFetch(path, opts = {}) {
  const token = getAdminToken();
  const headers = { ...(opts.headers || {}), 'x-admin-token': token };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    setAdminToken(''); throw new AdminAuthError();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
}

export async function adminPing() { return adminFetch('/admin/competitions'); }

// ---------- Admin: competitions ----------

export async function getAdminCompetitions() { return adminFetch('/admin/competitions'); }

export async function saveAdminCompetitions(competitions) {
  return adminFetch('/admin/competitions', {
    method: 'PUT',
    body: JSON.stringify({ competitions }),
  });
}

export async function createAdminCompetition(competition) {
  return adminFetch('/admin/competitions', {
    method: 'POST',
    body: JSON.stringify({ competition }),
  });
}

export async function deleteAdminCompetition(slug) {
  return adminFetch(`/admin/competitions/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}

// ---------- Admin: scoped tasks/boards/participants/private ----------

function adminCompBase(slug) {
  return `/admin/competitions/${encodeURIComponent(slug)}`;
}

export async function getAdminTasks(slug) { return adminFetch(`${adminCompBase(slug)}/tasks`); }
export async function saveAdminTasks(slug, tasks) {
  return adminFetch(`${adminCompBase(slug)}/tasks`, { method: 'PUT', body: JSON.stringify({ tasks }) });
}

export async function getAdminBoards(slug) { return adminFetch(`${adminCompBase(slug)}/boards`); }
export async function saveAdminBoards(slug, boards) {
  return adminFetch(`${adminCompBase(slug)}/boards`, { method: 'PUT', body: JSON.stringify({ boards }) });
}

export async function getAdminParticipants(slug) {
  return adminFetch(`${adminCompBase(slug)}/participants`);
}
export async function saveAdminParticipants(slug, participants) {
  return adminFetch(`${adminCompBase(slug)}/participants`, {
    method: 'PUT',
    body: JSON.stringify({ participants }),
  });
}

export async function getAdminPrivate(slug, taskSlug) {
  return adminFetch(`${adminCompBase(slug)}/tasks/${encodeURIComponent(taskSlug)}/private`);
}
export async function uploadAdminPrivate(slug, taskSlug, csv) {
  return adminFetch(`${adminCompBase(slug)}/tasks/${encodeURIComponent(taskSlug)}/private`, {
    method: 'PUT', body: JSON.stringify({ csv }),
  });
}
export async function deleteAdminPrivate(slug, taskSlug) {
  return adminFetch(`${adminCompBase(slug)}/tasks/${encodeURIComponent(taskSlug)}/private`, {
    method: 'DELETE',
  });
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx --no-install vite build`
Expected: build падает с ошибками в `App.jsx` (там старые сигнатуры). Это нормально, фиксим в Task 11.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(frontend): api.js — scoped эндпоинты под competitionSlug"
```

---

### Task 10: `CompetitionsListPage` — главная

**Files:**
- Create: `frontend/src/CompetitionsListPage.jsx`

- [ ] **Step 1: Создать компонент**

Create `frontend/src/CompetitionsListPage.jsx`:
```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCompetitions } from './api';

export default function CompetitionsListPage() {
  const [data, setData] = useState({ loading: true, competitions: [], error: null });

  useEffect(() => {
    let active = true;
    getCompetitions()
      .then((r) => { if (active) setData({ loading: false, competitions: r.competitions || [], error: null }); })
      .catch((e) => { if (active) setData({ loading: false, competitions: [], error: e.message }); });
    return () => { active = false; };
  }, []);

  if (data.loading) return <p className="status">Загрузка соревнований...</p>;
  if (data.error) return <p className="status error">{data.error}</p>;
  if (data.competitions.length === 0) {
    return <p className="status">Соревнований пока нет — создайте в админке (/admin).</p>;
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Соревнования</h2></div>
      <div className="competitions-list">
        {data.competitions.map((c) => (
          <Link key={c.slug} to={`/competitions/${encodeURIComponent(c.slug)}/leaderboard`} className="competition-card">
            <div className="competition-title">{c.title}</div>
            {c.subtitle ? <div className="competition-subtitle">{c.subtitle}</div> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Стили карточек**

В `frontend/src/styles.css` (в конце):
```css
.competitions-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  padding: 24px;
}

.competition-card {
  display: block;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: border-color 120ms ease, transform 120ms ease;
}

.competition-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.competition-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 6px;
}

.competition-subtitle {
  font-size: 13px;
  color: var(--muted);
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/CompetitionsListPage.jsx frontend/src/styles.css
git commit -m "feat(frontend): CompetitionsListPage — главная со списком соревнований"
```

---

### Task 11: Refactor публичных pages для чтения `:competitionSlug`

**Files:**
- Modify: `frontend/src/App.jsx`

Все существующие публичные страницы (`OverallPage`, `CyclingOverallPage`, `BoardPage`, `TaskPage`, `ObsOverall`, `ObsBoard`, `ObsTask`, `ObsBoardBar`) и `ObsCard`/`ObsCycle` (отдельные файлы) должны читать `competitionSlug` из URL params и передавать в API-вызовы.

- [ ] **Step 1: OverallPage — добавить useParams**

В `OverallPage` (≈line 218):
```jsx
function OverallPage() {
  const { competitionSlug } = useParams();
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  // … остальное без изменений
```

- [ ] **Step 2: CyclingOverallPage**

```jsx
function CyclingOverallPage() {
  const { competitionSlug } = useParams();
  // …
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  // …
```

- [ ] **Step 3: BoardPage**

```jsx
function BoardPage({ boards }) {
  const { competitionSlug, slug } = useParams();
  const board = (boards || []).find((b) => b.slug === slug);
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  // …
```

- [ ] **Step 4: TaskPage**

```jsx
function TaskPage() {
  const { competitionSlug, slug } = useParams();
  const { data, loading, error } = usePolling(() => getTaskLeaderboard(competitionSlug, slug), [competitionSlug, slug]);
  // …
```

- [ ] **Step 5: ObsOverall, ObsBoard, ObsTask, ObsBoardBar**

В каждом — добавить `const { competitionSlug } = useParams();` и передать в `getOverallLeaderboard(competitionSlug)` / `getTaskLeaderboard(competitionSlug, slug)`.

Также `ObsBoard` и `ObsBoardBar` читают boards: заменить `getBoards()` на `getBoards(competitionSlug)`.

- [ ] **Step 6: Layout — табы scoped к competitionSlug**

`Layout` (≈line 170) сейчас принимает `tasks, boards`. Менять не сильно — но ссылки в табах должны быть префиксованы:

```jsx
function Layout({ children, tasks, boards, competitionSlug }) {
  const visibleBoards = sortedVisibleBoards(boards);
  const base = `/competitions/${encodeURIComponent(competitionSlug)}`;
  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow"><Link to="/" className="eyebrow-link">← все соревнования</Link></p>
        <h1>NEOAI</h1>
        <p className="subtitle">Live Leaderboard · нормализация: top1 = 100, last = 0. Общий балл = сумма по всем задачам.</p>
      </header>

      <nav className="tabs">
        <NavLink to={`${base}/leaderboard`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          Общий ЛБ
        </NavLink>
        <NavLink to={`${base}/cycle`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
          По 15 (цикл)
        </NavLink>
        {visibleBoards.map((board) => (
          <NavLink key={board.slug} to={`${base}/board/${board.slug}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {board.title}
          </NavLink>
        ))}
        {tasks.map((task) => (
          <NavLink key={task.slug} to={`${base}/task/${task.slug}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {task.title}
          </NavLink>
        ))}
      </nav>

      <main>{children}</main>
    </div>
  );
}
```

(Заголовок `<h1>NEOAI</h1>` сейчас захардкожен — оставляем как есть в этом таске; правка на динамический title — Task 14.)

- [ ] **Step 7: ObsCycle.jsx — competitionSlug from params**

В `frontend/src/ObsCycle.jsx`:
```jsx
import { useParams } from 'react-router-dom';
// …
export default function ObsCycle() {
  const { competitionSlug } = useParams();
  // …
  const { data, loading, error } = usePolling(() => getOverallLeaderboard(competitionSlug));
  // …
}
```

И `useEffect(() => { … }, [])` — поменять deps на `[competitionSlug]`.

- [ ] **Step 8: ObsCard.jsx — competitionSlug**

В `frontend/src/ObsCard.jsx` — те же правки: `useParams`, `getCurrentCard(competitionSlug)`.

- [ ] **Step 9: Verify build**

Run: `cd frontend && npx --no-install vite build`
Expected: build всё ещё может падать на маршрутах в `App.jsx` — будем чинить в Task 14. Минимально проверь что не сломаны импорты.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/App.jsx frontend/src/ObsCycle.jsx frontend/src/ObsCard.jsx
git commit -m "refactor(frontend): publi pages читают competitionSlug из useParams"
```

---

### Task 12: `AdminCompetitionsPage` — CRUD соревнований

**Files:**
- Create: `frontend/src/AdminCompetitionsPage.jsx`

- [ ] **Step 1: Создать компонент**

Create `frontend/src/AdminCompetitionsPage.jsx`:
```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getAdminCompetitions,
  saveAdminCompetitions,
  createAdminCompetition,
  deleteAdminCompetition,
} from './api';

export default function AdminCompetitionsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ slug: '', title: '', subtitle: '', order: 0, visible: true });

  async function refresh() {
    try {
      setLoading(true);
      const r = await getAdminCompetitions();
      setList(r.competitions || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  function updateAt(idx, field, value) {
    setList((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  }

  async function saveAll() {
    setBusy(true); setError(null);
    try {
      await saveAdminCompetitions(list);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    setBusy(true); setError(null);
    try {
      const payload = {
        slug: draft.slug.trim(),
        title: draft.title.trim(),
        order: Number(draft.order) || 0,
        visible: !!draft.visible,
      };
      if (draft.subtitle.trim()) payload.subtitle = draft.subtitle.trim();
      await createAdminCompetition(payload);
      setDraft({ slug: '', title: '', subtitle: '', order: 0, visible: true });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(slug) {
    if (!window.confirm(`Удалить соревнование '${slug}'? Файлы переименуются в .deleted-<ts>.`)) return;
    setBusy(true); setError(null);
    try {
      await deleteAdminCompetition(slug);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="status">Загрузка...</p>;

  return (
    <section className="panel">
      <div className="panel-head"><h2>Соревнования</h2></div>
      {error ? <p className="status error">{error}</p> : null}

      <div className="admin-comp-create">
        <h3>+ Новое соревнование</h3>
        <div className="admin-comp-row">
          <input placeholder="slug" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
          <input placeholder="title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="subtitle (опц.)" value={draft.subtitle} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
          <input type="number" placeholder="order" value={draft.order} onChange={(e) => setDraft({ ...draft, order: e.target.value })} />
          <label><input type="checkbox" checked={draft.visible} onChange={(e) => setDraft({ ...draft, visible: e.target.checked })} /> visible</label>
          <button disabled={busy || !draft.slug || !draft.title} onClick={createNew}>Создать</button>
        </div>
      </div>

      <table className="admin-comp-table">
        <thead><tr><th>slug</th><th>title</th><th>subtitle</th><th>order</th><th>visible</th><th></th></tr></thead>
        <tbody>
          {list.map((c, idx) => (
            <tr key={c.slug}>
              <td><Link to={`/admin/competitions/${encodeURIComponent(c.slug)}/tasks`}>{c.slug}</Link></td>
              <td><input value={c.title} onChange={(e) => updateAt(idx, 'title', e.target.value)} /></td>
              <td><input value={c.subtitle || ''} onChange={(e) => updateAt(idx, 'subtitle', e.target.value)} /></td>
              <td><input type="number" value={c.order ?? 0} onChange={(e) => updateAt(idx, 'order', Number(e.target.value))} /></td>
              <td><input type="checkbox" checked={c.visible !== false} onChange={(e) => updateAt(idx, 'visible', e.target.checked)} /></td>
              <td><button onClick={() => remove(c.slug)}>🗑</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <button disabled={busy} onClick={saveAll} className="control-btn" style={{ margin: 16 }}>
        💾 Сохранить все
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Минимальные стили**

В `frontend/src/styles.css` (в конце):
```css
.admin-comp-create { padding: 16px; border-bottom: 1px solid var(--border); }
.admin-comp-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.admin-comp-row input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text); }
.admin-comp-table { width: 100%; border-collapse: collapse; }
.admin-comp-table th, .admin-comp-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; }
.admin-comp-table input { width: 100%; padding: 4px 8px; background: transparent; color: var(--text); border: 1px solid transparent; border-radius: 4px; }
.admin-comp-table input:focus { border-color: var(--accent); outline: none; }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/AdminCompetitionsPage.jsx frontend/src/styles.css
git commit -m "feat(frontend): /admin/competitions — CRUD соревнований"
```

---

### Task 13: `AdminParticipantsPage` — JSON paste/upload

**Files:**
- Create: `frontend/src/AdminParticipantsPage.jsx`

- [ ] **Step 1: Создать компонент**

Create `frontend/src/AdminParticipantsPage.jsx`:
```jsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAdminParticipants, saveAdminParticipants } from './api';

const PLACEHOLDER = `[
  {
    "id": "ivanov-ivan",
    "name": "Иванов Иван Иванович",
    "kaggleId": "ivanovii",
    "photo": "/photos/anna-smirnova.jpg",
    "role": "Участник",
    "city": "Москва",
    "grade": "10 класс",
    "achievements": [],
    "bio": ""
  }
]`;

export default function AdminParticipantsPage() {
  const { slug: competitionSlug } = useParams();
  const [text, setText] = useState('');
  const [current, setCurrent] = useState([]);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const r = await getAdminParticipants(competitionSlug);
      setCurrent(r.participants || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { refresh(); }, [competitionSlug]);

  // Live preview: count + first 3.
  let parsed = null;
  let parseError = null;
  if (text.trim()) {
    try {
      const v = JSON.parse(text);
      if (!Array.isArray(v)) throw new Error('не массив');
      parsed = v;
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }
  }

  async function onFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const t = await file.text();
    setText(t);
  }

  async function save() {
    if (!parsed) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await saveAdminParticipants(competitionSlug, parsed);
      setInfo(`Сохранено: ${r.count}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Участники: {competitionSlug}</h2></div>

      <div className="admin-pp-upload">
        <input type="file" accept=".json,application/json" onChange={onFile} />
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>или вставь JSON ниже</span>
      </div>

      <textarea
        className="admin-pp-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={PLACEHOLDER}
        rows={20}
      />

      <div className="admin-pp-preview">
        {parseError ? <p className="status error">JSON невалиден: {parseError}</p>
          : parsed ? (
            <div>
              <p>Распознано записей: <b>{parsed.length}</b></p>
              {parsed.length > 0 ? (
                <ul>
                  {parsed.slice(0, 3).map((p, i) => (
                    <li key={i}>{p.name || p.id || '?'} — kaggleId: {p.kaggleId || '—'}</li>
                  ))}
                  {parsed.length > 3 ? <li>… и ещё {parsed.length - 3}</li> : null}
                </ul>
              ) : null}
            </div>
          ) : null}
      </div>

      <button disabled={busy || !parsed} onClick={save} className="control-btn" style={{ margin: 16 }}>
        Заменить участников
      </button>

      {error ? <p className="status error">{error}</p> : null}
      {info ? <p className="status">{info}</p> : null}

      <h3 style={{ margin: '24px 16px 8px' }}>Текущие участники: {current.length}</h3>
      <table className="admin-pp-table">
        <thead><tr><th>name</th><th>kaggleId</th></tr></thead>
        <tbody>
          {current.map((p) => (
            <tr key={p.id}>
              <td>{p.name || '—'}</td>
              <td>{p.kaggleId || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Стили**

В `frontend/src/styles.css`:
```css
.admin-pp-upload { padding: 16px; display: flex; gap: 12px; align-items: center; }
.admin-pp-textarea { width: calc(100% - 32px); margin: 0 16px; font-family: ui-monospace, monospace; font-size: 12px; padding: 12px; background: transparent; color: var(--text); border: 1px solid var(--border); border-radius: 8px; }
.admin-pp-preview { padding: 8px 16px; }
.admin-pp-table { width: 100%; border-collapse: collapse; }
.admin-pp-table th, .admin-pp-table td { padding: 6px 16px; border-bottom: 1px solid var(--border); text-align: left; }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/AdminParticipantsPage.jsx frontend/src/styles.css
git commit -m "feat(frontend): /admin/competitions/<slug>/participants — JSON paste/upload"
```

---

### Task 14: Refactor существующих admin pages под scoped + новые routes

**Files:**
- Modify: `frontend/src/App.jsx` (admin pages)

- [ ] **Step 1: AdminTasksPage — competitionSlug**

В `AdminTasksPage` (около line 1115):
```jsx
function AdminTasksPage() {
  const { slug: competitionSlug } = useParams();
  // …
  // Заменить: getAdminTasks() → getAdminTasks(competitionSlug)
  // Заменить: saveAdminTasks(tasks) → saveAdminTasks(competitionSlug, tasks)
  // Все вызовы getAdminPrivate(slug) → getAdminPrivate(competitionSlug, taskSlug)
  // uploadAdminPrivate(slug, csv) → uploadAdminPrivate(competitionSlug, taskSlug, csv)
  // deleteAdminPrivate(slug) → deleteAdminPrivate(competitionSlug, taskSlug)
}
```

Применимо аналогично `AdminBoardsPage` (≈line 1302):
```jsx
function AdminBoardsPage() {
  const { slug: competitionSlug } = useParams();
  // getAdminBoards() → getAdminBoards(competitionSlug)
  // saveAdminBoards(boards) → saveAdminBoards(competitionSlug, boards)
}
```

И `ControlPage` (≈line 771) — это `/admin/card`:
```jsx
function ControlPage() {
  const { slug: competitionSlug } = useParams();
  // getParticipants() → getParticipants(competitionSlug)  // публичный API ОК
  // setCurrentCard(id) → setCurrentCard(competitionSlug, id)
  // getCurrentCard() → getCurrentCard(competitionSlug)
}
```

(Все `useParams` берут `slug`, потому что в роуте параметр будет назван `:slug` — см. Task 15.)

- [ ] **Step 2: AdminShell — таб-бар scoped**

`AdminShell` (≈line 1500) сейчас рисует табы `Tasks/Boards/Card`. Расширить:
```jsx
function AdminShell() {
  const navigate = useNavigate();
  const { slug: competitionSlug } = useParams();
  const base = competitionSlug ? `/admin/competitions/${encodeURIComponent(competitionSlug)}` : '';
  // …
  return (
    <div className="admin-page">
      <header className="hero">
        <h1>NEOAI Admin</h1>
        <Link to="/admin/competitions" className="eyebrow-link">← все соревнования</Link>
      </header>
      {competitionSlug ? (
        <nav className="tabs">
          <NavLink to={`${base}/tasks`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Tasks</NavLink>
          <NavLink to={`${base}/boards`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Boards</NavLink>
          <NavLink to={`${base}/participants`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Participants</NavLink>
          <NavLink to={`${base}/card`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>Card</NavLink>
        </nav>
      ) : null}
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "refactor(frontend): admin pages читают competitionSlug, табы scoped"
```

---

### Task 15: Обновить routes в `App.jsx`

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Импорты**

Добавить:
```jsx
import CompetitionsListPage from './CompetitionsListPage';
import AdminCompetitionsPage from './AdminCompetitionsPage';
import AdminParticipantsPage from './AdminParticipantsPage';
```

- [ ] **Step 2: Удалить старые маршруты, добавить новые**

В `MainShell` или там где `<Routes>` определены публичные роуты — заменить старые `/`/`/cycle`/`/board/:slug`/`/task/:slug` на:

```jsx
<Routes>
  <Route path="/" element={<CompetitionsListPage />} />
  <Route path="/competitions/:competitionSlug" element={
    <Navigate to="leaderboard" replace />
  } />
  <Route path="/competitions/:competitionSlug" element={<CompetitionShell />}>
    <Route path="leaderboard" element={<OverallPage />} />
    <Route path="cycle" element={<CyclingOverallPage />} />
    <Route path="board/:slug" element={<BoardPage boards={boards} />} />
    <Route path="task/:slug" element={<TaskPage />} />
  </Route>

  <Route path="/admin" element={<AdminAuthGate />}>
    <Route index element={<Navigate to="competitions" replace />} />
    <Route path="competitions" element={<AdminCompetitionsPage />} />
    <Route path="competitions/:slug" element={<AdminShell />}>
      <Route index element={<Navigate to="tasks" replace />} />
      <Route path="tasks" element={<AdminTasksPage />} />
      <Route path="boards" element={<AdminBoardsPage />} />
      <Route path="participants" element={<AdminParticipantsPage />} />
      <Route path="card" element={<ControlPage />} />
    </Route>
  </Route>

  {/* OBS — без шапки */}
  <Route path="/obs/competitions/:competitionSlug/overall" element={<ObsOverall />} />
  <Route path="/obs/competitions/:competitionSlug/cycle" element={<ObsCycle />} />
  <Route path="/obs/competitions/:competitionSlug/board/:slug" element={<ObsBoard />} />
  <Route path="/obs/competitions/:competitionSlug/bar/board/:slug" element={<ObsBoardBar />} />
  <Route path="/obs/competitions/:competitionSlug/task/:slug" element={<ObsTask />} />
  <Route path="/obs/competitions/:competitionSlug/card" element={<ObsCard />} />
</Routes>
```

`CompetitionShell` — новый компонент-обёртка, который грузит `tasks`/`boards` для `competitionSlug` и рендерит `<Layout>` с табами + `<Outlet>`:

```jsx
function CompetitionShell() {
  const { competitionSlug } = useParams();
  const tasksState = usePolling(() => getOverallLeaderboard(competitionSlug), [competitionSlug]);
  const boardsState = usePolling(() => getBoards(competitionSlug), [competitionSlug]);

  if (tasksState.loading || boardsState.loading) {
    return <p className="status">Загрузка...</p>;
  }
  if (tasksState.error) {
    return <p className="status error">{tasksState.error}</p>;
  }
  return (
    <Layout
      tasks={tasksState.data?.tasks || []}
      boards={boardsState.data?.boards || []}
      competitionSlug={competitionSlug}
    >
      <Outlet />
    </Layout>
  );
}
```

(Если `BoardPage` сейчас принимает `boards` как пропс — теперь boards приходят из CompetitionShell через React Router context. Самый простой способ — передавать через `useOutletContext` или заново фетчить внутри BoardPage. Прагматично: BoardPage сам фетчит `getBoards(competitionSlug)`.)

Заменить `<Route path="board/:slug" element={<BoardPage boards={boards} />} />` на `<Route path="board/:slug" element={<BoardPageWrapper />} />`, где:

```jsx
function BoardPageWrapper() {
  const { competitionSlug } = useParams();
  const { data, loading, error } = usePolling(() => getBoards(competitionSlug), [competitionSlug]);
  if (loading) return <p className="status">Загрузка...</p>;
  if (error) return <p className="status error">{error}</p>;
  return <BoardPage boards={data?.boards || []} />;
}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx --no-install vite build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(frontend): новые маршруты под /competitions/<slug>/* и /admin/competitions/<slug>/*"
```

---

### Task 16: Legacy redirects для старых URL

**Files:**
- Create: `frontend/src/legacyRedirects.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Создать `legacyRedirects.jsx`**

Create `frontend/src/legacyRedirects.jsx`:
```jsx
import { Navigate, useParams } from 'react-router-dom';

const NEOAI = 'neoai-2026';

export const LEGACY_REDIRECTS = [
  { from: '/cycle', to: `/competitions/${NEOAI}/cycle` },
  { from: '/control', to: `/admin/competitions/${NEOAI}/card` },
  { from: '/admin/tasks', to: `/admin/competitions/${NEOAI}/tasks` },
  { from: '/admin/boards', to: `/admin/competitions/${NEOAI}/boards` },
  { from: '/admin/card', to: `/admin/competitions/${NEOAI}/card` },
  { from: '/obs/overall', to: `/obs/competitions/${NEOAI}/overall` },
  { from: '/obs/cycle', to: `/obs/competitions/${NEOAI}/cycle` },
  { from: '/obs/card', to: `/obs/competitions/${NEOAI}/card` },
];

// Routes с :slug в URL.
export function LegacyBoardRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/competitions/${NEOAI}/board/${slug}`} replace />;
}

export function LegacyTaskRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/competitions/${NEOAI}/task/${slug}`} replace />;
}

export function LegacyObsBoardRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/obs/competitions/${NEOAI}/board/${slug}`} replace />;
}

export function LegacyObsBoardBarRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/obs/competitions/${NEOAI}/bar/board/${slug}`} replace />;
}

export function LegacyObsTaskRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/obs/competitions/${NEOAI}/task/${slug}`} replace />;
}
```

- [ ] **Step 2: Подключить в `App.jsx`**

В `<Routes>` добавить (после новых маршрутов):
```jsx
import {
  LEGACY_REDIRECTS,
  LegacyBoardRedirect, LegacyTaskRedirect,
  LegacyObsBoardRedirect, LegacyObsBoardBarRedirect, LegacyObsTaskRedirect,
} from './legacyRedirects';

// в <Routes>:
{LEGACY_REDIRECTS.map((r) => (
  <Route key={r.from} path={r.from} element={<Navigate to={r.to} replace />} />
))}
<Route path="/board/:slug" element={<LegacyBoardRedirect />} />
<Route path="/task/:slug" element={<LegacyTaskRedirect />} />
<Route path="/obs/board/:slug" element={<LegacyObsBoardRedirect />} />
<Route path="/obs/bar/board/:slug" element={<LegacyObsBoardBarRedirect />} />
<Route path="/obs/task/:slug" element={<LegacyObsTaskRedirect />} />
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx --no-install vite build`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/legacyRedirects.jsx frontend/src/App.jsx
git commit -m "feat(frontend): legacy redirects старых URL → /competitions/neoai-2026/..."
```

---

## Phase 5 — Docs and smoke

### Task 17: Update `ROUTES.md`

**Files:**
- Modify: `new_lb/ROUTES.md`

- [ ] **Step 1: Полная замена ROUTES.md**

Полностью переписать `new_lb/ROUTES.md` (старый контент устарел):

```markdown
# Routes

Все фронт-маршруты обслуживает SPA. API живёт под `/api/*`.

## Multi-tenant

Главная `/` — список соревнований. Каждое соревнование живёт под `/competitions/<slug>/...` со своим набором задач/бордов/участников.

## Публичные страницы

| URL | Что |
| --- | --- |
| `/` | Список видимых соревнований |
| `/competitions/<slug>` | Редирект на `leaderboard` |
| `/competitions/<slug>/leaderboard` | Общий ЛБ |
| `/competitions/<slug>/cycle` | Циклическая показ по 15 строк |
| `/competitions/<slug>/board/<b>` | Лидерборд борда |
| `/competitions/<slug>/task/<t>` | Лидерборд задачи |

## OBS

| URL |
| --- |
| `/obs/competitions/<slug>/overall` |
| `/obs/competitions/<slug>/cycle` |
| `/obs/competitions/<slug>/board/<b>` |
| `/obs/competitions/<slug>/bar/board/<b>` |
| `/obs/competitions/<slug>/task/<t>` |
| `/obs/competitions/<slug>/card` |

## Админ

| URL | Что |
| --- | --- |
| `/admin` | Логин |
| `/admin/competitions` | CRUD соревнований |
| `/admin/competitions/<slug>/tasks` | CRUD задач (scoped) |
| `/admin/competitions/<slug>/boards` | CRUD бордов (scoped) |
| `/admin/competitions/<slug>/participants` | JSON paste/upload |
| `/admin/competitions/<slug>/card` | OBS-карточка (scoped) |

## Legacy redirects

Поддерживаются временно (1-2 недели после раскатки):

`/cycle`, `/board/<s>`, `/task/<s>`, `/control`, `/admin/tasks`, `/admin/boards`, `/admin/card`, `/obs/{overall,cycle,board/<s>,bar/board/<s>,task/<s>,card}` → редиректят на эквивалент с `competitions/neoai-2026/`.

## Backend API

### Глобальные

| Method | Path | Что |
| --- | --- | --- |
| GET | `/api/health` | Статус, состояние всех соревнований |
| GET | `/api/competitions` | Видимые соревнования |

### Per-competition (публично)

| Method | Path |
| --- | --- |
| GET | `/api/competitions/<slug>` |
| GET | `/api/competitions/<slug>/leaderboard` |
| GET | `/api/competitions/<slug>/tasks/<t>` |
| GET | `/api/competitions/<slug>/boards` |
| GET | `/api/competitions/<slug>/participants` |
| POST | `/api/competitions/<slug>/refresh` |
| GET | `/api/competitions/<slug>/card` |
| POST | `/api/competitions/<slug>/card` |

### Админ (заголовок `x-admin-token`)

| Method | Path |
| --- | --- |
| GET/PUT | `/api/admin/competitions` |
| POST | `/api/admin/competitions` |
| DELETE | `/api/admin/competitions/<slug>` |
| GET/PUT | `/api/admin/competitions/<slug>/tasks` |
| GET/PUT | `/api/admin/competitions/<slug>/boards` |
| GET/PUT | `/api/admin/competitions/<slug>/participants` |
| GET/PUT/DELETE | `/api/admin/competitions/<slug>/tasks/<t>/private` |

## Файлы данных

```
data/
  competitions.json             # индекс
  competitions/<slug>/
    tasks.json
    boards.json
    participants.json
    state.json                  # currentParticipantId
  private/<slug>/<task>.csv
```

## ENV-переменные backend

| Переменная | Дефолт | Что |
| --- | --- | --- |
| `PORT` | `3001` | Порт |
| `REFRESH_MS` | `60000` | Интервал sweep'а всех соревнований |
| `REQUEST_GAP_MS` | `3000` | Пауза между Kaggle-запросами |
| `KAGGLE_CMD` | `kaggle` | Бинарь Kaggle CLI |
| `DATA_DIR` | `./data` | Корень data |
| `ADMIN_TOKEN` | (пусто) | Токен админки |
```

- [ ] **Step 2: Commit**

```bash
git add ROUTES.md
git commit -m "docs: ROUTES.md под мульти-тенант"
```

---

### Task 18: Manual smoke test

**Files:** none

Этот таск — ручной чек-лист, чтобы убедиться, что миграция и фичи работают на dev-машине перед деплоем.

- [ ] **Step 1: Подготовить dev-окружение**

```bash
cd backend && npm install && npm test
```
Expected: все тесты проходят.

- [ ] **Step 2: Запустить бэк локально**

В отдельном терминале:
```bash
cd backend && ADMIN_TOKEN=devsecret npm run dev
```
Expected: лог `Backend started on http://localhost:3001`. Если есть `data/{tasks,boards,participants}.json` — увидеть лог `[migrate] OK: legacy → neoai-2026`. Если нет — ничего не падает, индекс пустой.

- [ ] **Step 3: Проверить API**

```bash
curl -s http://localhost:3001/api/health | jq
curl -s http://localhost:3001/api/competitions | jq
curl -s http://localhost:3001/api/competitions/neoai-2026 | jq
curl -s http://localhost:3001/api/competitions/wrong | jq    # 404
```

- [ ] **Step 4: Запустить фронт**

```bash
cd frontend && npm install && npm run dev
```
Открыть http://localhost:5173/ — должен быть список соревнований с одной карточкой NEOAI 2026.

- [ ] **Step 5: Пройти основные сценарии**

- [ ] Кликнуть на карточку → попасть на `/competitions/neoai-2026/leaderboard`.
- [ ] Открыть `/cycle` → редирект на `/competitions/neoai-2026/cycle`.
- [ ] Открыть `/admin` → залогиниться → попасть на `/admin/competitions`.
- [ ] Создать новое соревнование с slug `test-2027` → должно появиться в списке.
- [ ] Перейти в `/admin/competitions/test-2027/participants` → вставить минимальный JSON `[{"id":"a","name":"A","kaggleId":"a"}]` → нажать «Заменить».
- [ ] Перейти в `/admin/competitions/test-2027/tasks` → пусто, но страница загружается.
- [ ] Удалить `test-2027` → должна остаться только NEOAI.

- [ ] **Step 6: Если что-то сломалось**

— фиксить по месту, делать новые коммиты «fix(...)». Если фундаментальная проблема — откат через `git reset` до начала фазы.

- [ ] **Step 7: Push**

```bash
git push
```

---

## Self-Review (для писавшего план)

Прошёл по чеклисту:

**1. Spec coverage:**
- ✅ Модель данных и файлы (Tasks 2-4)
- ✅ Миграция (Task 3)
- ✅ API surface (Tasks 6-7)
- ✅ Frontend routes (Tasks 10-11, 14-16)
- ✅ Admin UX (Tasks 12-13)
- ✅ Refresh logic (Task 5)
- ✅ Edge cases (валидация в Task 2 + 404 handling в Task 6)
- ✅ Tests (Tasks 2, 3, 8)

**2. Placeholder scan:** Прошёлся, плейсхолдеров «TBD/TODO/similar to» нет. Все шаги содержат либо exact code, либо exact команды.

**3. Type consistency:**
- `validateCompetitions`, `loadCompetitions`, `saveCompetitions` — сигнатуры одинаковые во всех тасках.
- `competitionDir(slug)` / `privateDirFor(slug)` — определены в Task 5, используются в 6, 7, 8.
- `emptyCompetitionCache()` / `getCompCache(slug)` — определены в Task 5, используются в 6.
- `getOverallLeaderboard(slug)` — Task 9 определяет, Tasks 11, 15 используют.

**4. Scope check:** Один subsystem (multi-tenant competitions). Один план.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-03-competitions-builder.md`. Two execution options:

1. **Subagent-Driven (recommended)** — отдельный subagent на таск, ревью между тасками, быстрая итерация.
2. **Inline Execution** — таски в этой сессии, batch с чекпоинтами.

Какой подход?
