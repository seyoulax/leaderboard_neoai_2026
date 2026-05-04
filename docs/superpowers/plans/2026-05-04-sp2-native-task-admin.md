# SP-2 — Native Task Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Авторская часть платформы: админ может опубликовать нативную задачу с описанием (markdown), датасетами, стартовыми артефактами и приватным `score.py`+ground-truth. Залогиненный участник видит описание, скачивает файлы. Параллельно — `competitions.visibility=public/unlisted` и поиск по каталогу.

**Architecture:** Расширение SQLite-схемы из SP-1 миграцией 0002 (новые таблицы `native_tasks`, `native_task_files`, колонка `visibility` на `competitions`). Файлы — на диске в `data/native/<comp>/<task>/{dataset,artifact}/`, путь хранится в БД. Multipart upload через `busboy` стримом с sha256 on-the-fly + atomic rename. Public endpoints для `type=native` читают из БД on-demand (без cache-loop'a, в отличие от kaggle, где Kaggle CLI медленный). Markdown — raw в БД, рендер через `react-markdown` + `rehype-sanitize` на фронте.

**Tech Stack:** Node 20 + Express + `node:test`, `better-sqlite3`, `busboy ^1.6`, `archiver ^7`, React 18 + Vite, `react-markdown ^9`, `rehype-sanitize ^6`.

**Spec:** `docs/superpowers/specs/2026-05-04-sp2-native-task-admin-design.md`

**Prereq:** SP-1 завершён и в main (commit на ветке main содержит `users`/`sessions`/`competitions`/`competition_members` таблицы + `/api/auth/*`).

---

## File Structure

### Backend

| File | Status | Responsibility |
| --- | --- | --- |
| `backend/package.json` | modify | +`busboy`, `archiver` |
| `backend/src/db/migrations/0002_native_tasks.sql` | **create** | visibility + native_tasks + native_task_files |
| `backend/src/db/competitionsRepo.js` | modify | visibility filter, search, type-lock в upsert |
| `backend/src/db/nativeTasksRepo.js` | **create** | CRUD native tasks + soft-delete |
| `backend/src/db/nativeTaskFilesRepo.js` | **create** | insertPending / commitPath / list / get / delete |
| `backend/src/upload/safeFilename.js` | **create** | нормализация имён файлов |
| `backend/src/upload/multipartFile.js` | **create** | busboy stream → tmp → sha256 → atomic rename |
| `backend/src/upload/zipStream.js` | **create** | archiver-обёртка для zip-стримов |
| `backend/src/routes/nativeTasksAdmin.js` | **create** | admin CRUD endpoints |
| `backend/src/routes/nativeTasksPublic.js` | **create** | public GET endpoints + file streaming |
| `backend/src/app.js` | modify | mount routes, дисптач /leaderboard по type, visibility в /api/competitions |
| `backend/src/competitions.js` | modify | `validateCompetitions` принимает visibility |
| `backend/.env.example` | modify | +`NATIVE_DATA_DIR`, MAX_*_BYTES |
| `backend/tests/sp2_db.test.js` | **create** | repos + миграция 0002 |
| `backend/tests/sp2_upload.test.js` | **create** | multipart pipeline |
| `backend/tests/sp2_admin.test.js` | **create** | admin endpoints |
| `backend/tests/sp2_public.test.js` | **create** | public endpoints + auth gating |

### Frontend

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/package.json` | modify | +`react-markdown`, `rehype-sanitize` |
| `frontend/src/api.js` | modify | добавить `competitions.search`, `nativeTasks.*` |
| `frontend/src/CompetitionsListPage.jsx` | modify | добавить поле поиска (debounce) |
| `frontend/src/markdown/MarkdownView.jsx` | **create** | `react-markdown` + sanitize |
| `frontend/src/markdown/MarkdownEditor.jsx` | **create** | textarea + live preview |
| `frontend/src/native/NativeTaskPage.jsx` | **create** | публичная страница задачи |
| `frontend/src/native/NativeTaskFiles.jsx` | **create** | таблица файлов + zip-кнопки |
| `frontend/src/admin/AdminCompetitionsPage.jsx` | modify | radio visibility, type-lock на edit |
| `frontend/src/admin/AdminNativeTasksList.jsx` | **create** | список + кнопка «Создать» |
| `frontend/src/admin/AdminNativeTaskEdit.jsx` | **create** | страница редактирования задачи |
| `frontend/src/admin/AdminFileUploadRow.jsx` | **create** | inline загрузчик одного файла |
| `frontend/src/App.jsx` | modify | новые routes |

### Docs

| File | Status |
| --- | --- |
| `new_lb/README.md` | modify (env таблица + dev-flow) |
| `new_lb/ROUTES.md` | modify (новые endpoints, visibility) |

---

## Phase 0 — Подготовка

### Task 0.1: Установить зависимости

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json`, `frontend/package.json`, `frontend/package-lock.json`

- [ ] **Step 1: Backend deps**

```bash
cd backend
npm install busboy@^1.6 archiver@^7
```

- [ ] **Step 2: Frontend deps**

```bash
cd frontend
npm install react-markdown@^9 rehype-sanitize@^6
```

- [ ] **Step 3: Smoke**

```bash
cd backend && npm test
cd ../frontend && npm run build
```
Expected: backend tests зелёные, frontend build без ошибок (новые либы пока нигде не импортятся, это норма).

- [ ] **Step 4: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "chore(deps): sp2 backend (busboy, archiver) + frontend (react-markdown, rehype-sanitize)"
```

> Все git-команды в этом плане идут с `GIT_TERMINAL_PROMPT=0 git --no-pager` — иначе в этом окружении пейджер подвешивает. Если зависает даже так — ребутни Claude Code сессию.

---

## Phase 1 — Schema + repos

### Task 1.1: Migration 0002 — visibility + native tables

**Files:**
- Create: `backend/src/db/migrations/0002_native_tasks.sql`
- Create: `backend/tests/sp2_db.test.js`

- [ ] **Step 1: Падающий тест миграции**

`backend/tests/sp2_db.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

test('migration 0002: applied after 0001', () => {
  const db = freshDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((r) => r.version), [1, 2]);
});

test('migration 0002: visibility column on competitions with check', () => {
  const db = freshDb();
  // существующая запись из 0001 (если есть) получает default 'public'
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('a', 'A', 'kaggle')").run();
  const row = db.prepare("SELECT visibility FROM competitions WHERE slug='a'").get();
  assert.equal(row.visibility, 'public');
  assert.throws(
    () => db.prepare("INSERT INTO competitions (slug, title, type, visibility) VALUES ('b','B','kaggle','bogus')").run(),
    /CHECK/i
  );
});

test('migration 0002: legacy visible=0 → visibility=unlisted', () => {
  // Этот тест требует «состояние SP-1 с invisible competition» и потом проверяет миграцию.
  // Через свежую БД — установить visible=0 ПОСЛЕ runMigrations и проверить что он мигрирован
  // невозможно (миграция уже накатилась). Поэтому здесь делаем drop+recreate как ниже.
  const db = new Database(':memory:');
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)");
  // Накатываем 0001 руками
  const fs = require('node:fs');
  const path = require('node:path');
  const sql0001 = fs.readFileSync(path.join('src/db/migrations', '0001_init.sql'), 'utf8');
  db.exec(sql0001);
  db.prepare('INSERT INTO schema_migrations (version) VALUES (1)').run();
  // Вставляем legacy строку с visible=0
  db.prepare("INSERT INTO competitions (slug, title, type, visible) VALUES ('hidden','H','kaggle',0)").run();
  // Применяем 0002
  const sql0002 = fs.readFileSync(path.join('src/db/migrations', '0002_native_tasks.sql'), 'utf8');
  db.exec(sql0002);
  db.prepare('INSERT INTO schema_migrations (version) VALUES (2)').run();
  const row = db.prepare("SELECT visibility FROM competitions WHERE slug='hidden'").get();
  assert.equal(row.visibility, 'unlisted');
});

test('migration 0002: native_tasks + native_task_files exist with FKs', () => {
  const db = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(tables.includes('native_tasks'));
  assert.ok(tables.includes('native_task_files'));
  // FK на competitions
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare(`INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't1', 'T1')`).run();
  // unique (competition_slug, slug)
  assert.throws(
    () => db.prepare(`INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't1', 'dup')`).run(),
    /UNIQUE/i
  );
});
```

> Замечание: третий тест в node:test в ESM-only коде через `require` не пройдёт. Перепиши через `import fs from 'node:fs'` в шапке файла. Я оставил `require` для краткости — при имплементации замени.

Корректная шапка файла теста:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
```

И в теле тестов читай `fs.readFileSync(path.join(MIG_DIR, '0001_init.sql'), 'utf8')`.

- [ ] **Step 2: Run — FAIL** (нет файла `0002_native_tasks.sql`)

```bash
cd backend && node --test tests/sp2_db.test.js
```
Expected: FAIL on second/fourth test (column не найдена / таблица не найдена).

- [ ] **Step 3: Создать `0002_native_tasks.sql`**

`backend/src/db/migrations/0002_native_tasks.sql` — точный SQL из спеки SP-2, секция «Schema». Скопировать как есть.

- [ ] **Step 4: PASS**

```bash
cd backend && node --test tests/sp2_db.test.js
```

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/migrations/0002_native_tasks.sql backend/tests/sp2_db.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): migration 0002 — visibility + native_tasks + native_task_files"
```

---

### Task 1.2: nativeTasksRepo

**Files:**
- Create: `backend/src/db/nativeTasksRepo.js`
- Modify: `backend/tests/sp2_db.test.js`

- [ ] **Step 1: Падающие тесты**

Добавить в `sp2_db.test.js`:
```js
import {
  insertNativeTask,
  getNativeTask,
  listNativeTasks,
  updateNativeTask,
  softDeleteNativeTask,
} from '../src/db/nativeTasksRepo.js';

function seedComp(db, slug = 'c', type = 'native') {
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES (?, ?, ?)").run(slug, slug.toUpperCase(), type);
}

test('nativeTasksRepo.insertNativeTask + getNativeTask', () => {
  const db = freshDb();
  seedComp(db);
  const t = insertNativeTask(db, {
    competitionSlug: 'c',
    slug: 't1',
    title: 'T1',
    descriptionMd: '# Hi',
    higherIsBetter: true,
  });
  assert.equal(t.slug, 't1');
  assert.equal(t.descriptionMd, '# Hi');
  assert.equal(t.higherIsBetter, true);
  const got = getNativeTask(db, 'c', 't1');
  assert.equal(got.id, t.id);
});

test('nativeTasksRepo: scoring anchors round-trip', () => {
  const db = freshDb();
  seedComp(db);
  const t = insertNativeTask(db, {
    competitionSlug: 'c',
    slug: 't',
    title: 'T',
    baselineScorePublic: 0.5,
    authorScorePublic: 0.9,
    baselineScorePrivate: 0.4,
    authorScorePrivate: 0.85,
  });
  assert.equal(t.baselineScorePublic, 0.5);
  assert.equal(t.authorScorePublic, 0.9);
  assert.equal(t.baselineScorePrivate, 0.4);
  assert.equal(t.authorScorePrivate, 0.85);
});

test('nativeTasksRepo.listNativeTasks: hides soft-deleted', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 'a', title: 'A' });
  insertNativeTask(db, { competitionSlug: 'c', slug: 'b', title: 'B' });
  softDeleteNativeTask(db, 'c', 'a');
  const list = listNativeTasks(db, 'c').map((t) => t.slug);
  assert.deepEqual(list, ['b']);
});

test('nativeTasksRepo.updateNativeTask: partial update', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'old', descriptionMd: 'd' });
  updateNativeTask(db, 'c', 't', { title: 'new', descriptionMd: 'D2' });
  const got = getNativeTask(db, 'c', 't');
  assert.equal(got.title, 'new');
  assert.equal(got.descriptionMd, 'D2');
});

test('nativeTasksRepo.insertNativeTask: duplicate slug throws', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  assert.throws(
    () => insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'D' }),
    /UNIQUE/i
  );
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Реализация**

`backend/src/db/nativeTasksRepo.js`:
```js
const COLS = `id,
  competition_slug AS competitionSlug,
  slug,
  title,
  description_md AS descriptionMd,
  CAST(higher_is_better AS INTEGER) AS higherIsBetterRaw,
  baseline_score_public AS baselineScorePublic,
  author_score_public AS authorScorePublic,
  baseline_score_private AS baselineScorePrivate,
  author_score_private AS authorScorePrivate,
  grader_path AS graderPath,
  ground_truth_path AS groundTruthPath,
  CAST(visible AS INTEGER) AS visibleRaw,
  display_order AS displayOrder,
  created_at AS createdAt,
  deleted_at AS deletedAt`;

function rowToTask(row) {
  if (!row) return null;
  const t = { ...row, higherIsBetter: row.higherIsBetterRaw === 1, visible: row.visibleRaw === 1 };
  delete t.higherIsBetterRaw;
  delete t.visibleRaw;
  return t;
}

export function insertNativeTask(db, t) {
  const result = db
    .prepare(
      `INSERT INTO native_tasks (
        competition_slug, slug, title, description_md, higher_is_better,
        baseline_score_public, author_score_public,
        baseline_score_private, author_score_private,
        visible, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      t.competitionSlug,
      t.slug,
      t.title,
      t.descriptionMd ?? '',
      t.higherIsBetter === false ? 0 : 1,
      t.baselineScorePublic ?? null,
      t.authorScorePublic ?? null,
      t.baselineScorePrivate ?? null,
      t.authorScorePrivate ?? null,
      t.visible === false ? 0 : 1,
      Number.isFinite(t.displayOrder) ? t.displayOrder : 0
    );
  return getNativeTaskById(db, result.lastInsertRowid);
}

export function getNativeTaskById(db, id) {
  return rowToTask(db.prepare(`SELECT ${COLS} FROM native_tasks WHERE id = ?`).get(id));
}

export function getNativeTask(db, competitionSlug, slug) {
  return rowToTask(
    db
      .prepare(
        `SELECT ${COLS} FROM native_tasks
         WHERE competition_slug = ? AND slug = ? AND deleted_at IS NULL`
      )
      .get(competitionSlug, slug)
  );
}

export function listNativeTasks(db, competitionSlug) {
  return db
    .prepare(
      `SELECT ${COLS} FROM native_tasks
       WHERE competition_slug = ? AND deleted_at IS NULL
       ORDER BY display_order, slug`
    )
    .all(competitionSlug)
    .map(rowToTask);
}

const UPDATABLE = {
  title: 'title',
  descriptionMd: 'description_md',
  higherIsBetter: 'higher_is_better',
  baselineScorePublic: 'baseline_score_public',
  authorScorePublic: 'author_score_public',
  baselineScorePrivate: 'baseline_score_private',
  authorScorePrivate: 'author_score_private',
  graderPath: 'grader_path',
  groundTruthPath: 'ground_truth_path',
  visible: 'visible',
  displayOrder: 'display_order',
};

export function updateNativeTask(db, competitionSlug, slug, patch) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(UPDATABLE)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'higherIsBetter' || k === 'visible') v = v === false ? 0 : 1;
    sets.push(`${col} = ?`);
    vals.push(v);
  }
  if (!sets.length) return getNativeTask(db, competitionSlug, slug);
  vals.push(competitionSlug, slug);
  db.prepare(
    `UPDATE native_tasks SET ${sets.join(', ')}
     WHERE competition_slug = ? AND slug = ? AND deleted_at IS NULL`
  ).run(...vals);
  return getNativeTask(db, competitionSlug, slug);
}

export function softDeleteNativeTask(db, competitionSlug, slug) {
  db.prepare(
    `UPDATE native_tasks SET deleted_at = ?
     WHERE competition_slug = ? AND slug = ? AND deleted_at IS NULL`
  ).run(new Date().toISOString(), competitionSlug, slug);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/nativeTasksRepo.js backend/tests/sp2_db.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): nativeTasksRepo (CRUD + soft delete)"
```

---

### Task 1.3: nativeTaskFilesRepo

**Files:**
- Create: `backend/src/db/nativeTaskFilesRepo.js`
- Modify: `backend/tests/sp2_db.test.js`

- [ ] **Step 1: Тесты**

```js
import {
  insertPendingFile,
  commitFilePath,
  getFileById,
  listFilesByTask,
  deleteFileById,
  updateFileMetadata,
} from '../src/db/nativeTaskFilesRepo.js';

function seedTask(db) {
  seedComp(db);
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  return t;
}

test('files: insertPending → commitPath → list', () => {
  const db = freshDb();
  const task = seedTask(db);
  const row = insertPendingFile(db, {
    taskId: task.id,
    kind: 'dataset',
    displayName: 'train',
    description: '',
    originalFilename: 'train.csv',
    sizeBytes: 1024,
    sha256: 'abc',
  });
  assert.ok(row.id);
  commitFilePath(db, row.id, '/abs/path');
  const got = getFileById(db, row.id);
  assert.equal(got.path, '/abs/path');
  const list = listFilesByTask(db, task.id, 'dataset');
  assert.equal(list.length, 1);
});

test('files: kind filter', () => {
  const db = freshDb();
  const task = seedTask(db);
  const a = insertPendingFile(db, { taskId: task.id, kind: 'dataset', displayName: 'a', originalFilename: 'a', sizeBytes: 1, sha256: 'x' });
  commitFilePath(db, a.id, '/a');
  const b = insertPendingFile(db, { taskId: task.id, kind: 'artifact', displayName: 'b', originalFilename: 'b', sizeBytes: 1, sha256: 'y' });
  commitFilePath(db, b.id, '/b');
  assert.equal(listFilesByTask(db, task.id, 'dataset').length, 1);
  assert.equal(listFilesByTask(db, task.id, 'artifact').length, 1);
});

test('files: deleteById removes row', () => {
  const db = freshDb();
  const task = seedTask(db);
  const f = insertPendingFile(db, { taskId: task.id, kind: 'dataset', displayName: 'a', originalFilename: 'a', sizeBytes: 1, sha256: 'x' });
  commitFilePath(db, f.id, '/a');
  deleteFileById(db, f.id);
  assert.equal(getFileById(db, f.id), null);
});

test('files: updateMetadata changes display_name/description/order', () => {
  const db = freshDb();
  const task = seedTask(db);
  const f = insertPendingFile(db, { taskId: task.id, kind: 'dataset', displayName: 'a', originalFilename: 'a.csv', sizeBytes: 1, sha256: 'x' });
  commitFilePath(db, f.id, '/a');
  updateFileMetadata(db, f.id, { displayName: 'NEW', description: 'd', displayOrder: 5 });
  const got = getFileById(db, f.id);
  assert.equal(got.displayName, 'NEW');
  assert.equal(got.description, 'd');
  assert.equal(got.displayOrder, 5);
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/db/nativeTaskFilesRepo.js`:
```js
const COLS = `id,
  task_id AS taskId,
  kind,
  display_name AS displayName,
  description,
  original_filename AS originalFilename,
  size_bytes AS sizeBytes,
  sha256,
  path,
  display_order AS displayOrder,
  uploaded_at AS uploadedAt`;

export function insertPendingFile(db, f) {
  const result = db
    .prepare(
      `INSERT INTO native_task_files (
        task_id, kind, display_name, description,
        original_filename, size_bytes, sha256, path, display_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`
    )
    .run(
      f.taskId,
      f.kind,
      f.displayName,
      f.description ?? '',
      f.originalFilename,
      f.sizeBytes,
      f.sha256,
      Number.isFinite(f.displayOrder) ? f.displayOrder : 0
    );
  return getFileById(db, result.lastInsertRowid);
}

export function commitFilePath(db, id, finalPath) {
  db.prepare('UPDATE native_task_files SET path = ? WHERE id = ?').run(finalPath, id);
}

export function getFileById(db, id) {
  return db.prepare(`SELECT ${COLS} FROM native_task_files WHERE id = ?`).get(id) || null;
}

export function listFilesByTask(db, taskId, kind = null) {
  if (kind) {
    return db
      .prepare(`SELECT ${COLS} FROM native_task_files WHERE task_id = ? AND kind = ? ORDER BY display_order, id`)
      .all(taskId, kind);
  }
  return db
    .prepare(`SELECT ${COLS} FROM native_task_files WHERE task_id = ? ORDER BY kind, display_order, id`)
    .all(taskId);
}

export function deleteFileById(db, id) {
  db.prepare('DELETE FROM native_task_files WHERE id = ?').run(id);
}

const META_UPDATABLE = {
  displayName: 'display_name',
  description: 'description',
  displayOrder: 'display_order',
};

export function updateFileMetadata(db, id, patch) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(META_UPDATABLE)) {
    if (!(k in patch)) continue;
    sets.push(`${col} = ?`);
    vals.push(patch[k]);
  }
  if (!sets.length) return getFileById(db, id);
  vals.push(id);
  db.prepare(`UPDATE native_task_files SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getFileById(db, id);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/nativeTaskFilesRepo.js backend/tests/sp2_db.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): nativeTaskFilesRepo (insertPending/commitPath/list/delete/updateMetadata)"
```

---

### Task 1.4: competitionsRepo — visibility filter, search, type-lock

**Files:**
- Modify: `backend/src/db/competitionsRepo.js`
- Modify: `backend/tests/sp2_db.test.js`

- [ ] **Step 1: Тесты**

```js
import {
  insertCompetition,
  upsertCompetition,
  listVisibleCompetitions,
  searchPublicCompetitions,
} from '../src/db/competitionsRepo.js';

test('competitionsRepo.listVisibleCompetitions: только public + visible=1', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle', visibility: 'public', visible: true });
  insertCompetition(db, { slug: 'b', title: 'B', type: 'native', visibility: 'unlisted', visible: true });
  insertCompetition(db, { slug: 'c', title: 'C', type: 'kaggle', visibility: 'public', visible: false });
  const list = listVisibleCompetitions(db).map((c) => c.slug);
  assert.deepEqual(list, ['a']);
});

test('competitionsRepo.searchPublicCompetitions: case-insensitive LIKE по title', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'NEOAI 2026', type: 'kaggle', visibility: 'public' });
  insertCompetition(db, { slug: 'b', title: 'Kaggle Forces', type: 'kaggle', visibility: 'public' });
  insertCompetition(db, { slug: 'c', title: 'Hidden', type: 'native', visibility: 'unlisted' });
  assert.deepEqual(searchPublicCompetitions(db, 'neo').map((c) => c.slug), ['a']);
  assert.deepEqual(searchPublicCompetitions(db, 'KAGGLE').map((c) => c.slug), ['b']);
  assert.deepEqual(searchPublicCompetitions(db, 'hidden').map((c) => c.slug), []);
  assert.deepEqual(searchPublicCompetitions(db, '').map((c) => c.slug).sort(), ['a', 'b']); // empty q ≡ list all public
});

test('competitionsRepo.upsertCompetition: type-lock — менять type существующего соревнования нельзя', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  assert.throws(
    () => upsertCompetition(db, { slug: 'a', title: 'A', type: 'native' }),
    /type/i
  );
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Расширить competitionsRepo**

В `backend/src/db/competitionsRepo.js` (от SP-1) патчим:

1. **Добавить `visibility` в `COLUMNS`** (строкой):
```js
const COLUMNS = `slug, title, subtitle, type, visibility,
  CAST(visible AS INTEGER) AS visible,
  display_order AS displayOrder,
  created_at AS createdAt,
  deleted_at AS deletedAt`;
```

2. **`insertCompetition` принимает `visibility`** (default `'public'`):
```js
export function insertCompetition(db, c) {
  db.prepare(
    `INSERT INTO competitions (slug, title, subtitle, type, visibility, visible, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    c.slug,
    c.title,
    c.subtitle ?? null,
    c.type,
    c.visibility === 'unlisted' ? 'unlisted' : 'public',
    c.visible === false ? 0 : 1,
    Number.isFinite(c.displayOrder) ? c.displayOrder : 0
  );
  return getCompetition(db, c.slug);
}
```

3. **`upsertCompetition` блокирует смену type**:
```js
export function upsertCompetition(db, c) {
  const existing = db.prepare('SELECT type FROM competitions WHERE slug = ?').get(c.slug);
  if (existing && c.type && c.type !== existing.type) {
    throw new Error(`type lock: cannot change competition '${c.slug}' type from ${existing.type} to ${c.type}`);
  }
  if (existing) {
    db.prepare(
      `UPDATE competitions
       SET title = ?, subtitle = ?, visibility = ?, visible = ?, display_order = ?, deleted_at = NULL
       WHERE slug = ?`
    ).run(
      c.title,
      c.subtitle ?? null,
      c.visibility === 'unlisted' ? 'unlisted' : 'public',
      c.visible === false ? 0 : 1,
      Number.isFinite(c.displayOrder) ? c.displayOrder : 0,
      c.slug
    );
  } else {
    insertCompetition(db, c);
  }
  return getCompetition(db, c.slug);
}
```

4. **`listVisibleCompetitions`** — фильтр по `visibility='public' AND visible=1`:
```js
export function listVisibleCompetitions(db) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM competitions
       WHERE deleted_at IS NULL AND visibility = 'public' AND visible = 1
       ORDER BY display_order, slug`
    )
    .all()
    .map(rowToCompetition);
}
```

5. **Новая `searchPublicCompetitions(db, q)`**:
```js
export function searchPublicCompetitions(db, q) {
  const term = String(q ?? '').trim();
  if (!term) return listVisibleCompetitions(db);
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM competitions
       WHERE deleted_at IS NULL AND visibility = 'public' AND visible = 1
         AND title LIKE ? COLLATE NOCASE
       ORDER BY display_order, slug`
    )
    .all(`%${term}%`)
    .map(rowToCompetition);
}
```

6. **`rowToCompetition`** уже превращает `visible` в boolean — добавь возврат `visibility` как есть (это уже строка, ничего не нужно).

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/competitionsRepo.js backend/tests/sp2_db.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): competitionsRepo — visibility filter, search, type-lock in upsert"
```

---

## Phase 2 — Public visibility + search wire-up

### Task 2.1: GET /api/competitions поддерживает ?q=

**Files:**
- Modify: `backend/src/app.js`
- Create: `backend/tests/sp2_search.test.js`

- [ ] **Step 1: Тесты**

`backend/tests/sp2_search.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';

async function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /api/competitions: filters by visibility, supports q', async () => {
  const db = new Database(':memory:');
  runMigrations(db);
  insertCompetition(db, { slug: 'neoai-2026', title: 'NEOAI 2026', type: 'kaggle', visibility: 'public' });
  insertCompetition(db, { slug: 'kf', title: 'Kaggle Forces', type: 'kaggle', visibility: 'public' });
  insertCompetition(db, { slug: 'priv', title: 'Private', type: 'native', visibility: 'unlisted' });
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const all = await fetch(`http://127.0.0.1:${port}/api/competitions`).then((r) => r.json());
  assert.deepEqual(all.competitions.map((c) => c.slug).sort(), ['kf', 'neoai-2026']);
  const search = await fetch(`http://127.0.0.1:${port}/api/competitions?q=neo`).then((r) => r.json());
  assert.deepEqual(search.competitions.map((c) => c.slug), ['neoai-2026']);
  server.close();
});
```

- [ ] **Step 2: FAIL** (тест ругается на `priv` или возвращает все)

- [ ] **Step 3: Патч `app.js` — handler `/api/competitions`**

В `app.js` найти текущий handler:
```js
app.get('/api/competitions', (_req, res) => {
  const visible = listVisibleCompetitions(db);
  res.json({ competitions: visible });
});
```
Заменить на:
```js
app.get('/api/competitions', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const list = q ? searchPublicCompetitions(db, q) : listVisibleCompetitions(db);
  res.json({ competitions: list });
});
```
Импорт `searchPublicCompetitions` добавить в шапке.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/app.js backend/tests/sp2_search.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): GET /api/competitions?q= for public list search"
```

---

### Task 2.2: validateCompetitions учит visibility

**Files:**
- Modify: `backend/src/competitions.js`
- Modify: `backend/src/app.js` (admin POST/PUT competitions)

- [ ] **Step 1: Тест**

В `sp2_search.test.js` добавить:
```js
test('admin POST /api/admin/competitions: visibility=unlisted принимается', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = new Database(':memory:');
  runMigrations(db);
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'shared' },
    body: JSON.stringify({
      competition: { slug: 'u', title: 'Unlisted', type: 'native', visibility: 'unlisted' },
    }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.competition.visibility, 'unlisted');
  // Не появляется в public list
  const pub = await fetch(`http://127.0.0.1:${port}/api/competitions`).then((x) => x.json());
  assert.equal(pub.competitions.find((c) => c.slug === 'u'), undefined);
  // Но открывается по slug
  const meta = await fetch(`http://127.0.0.1:${port}/api/competitions/u`).then((x) => x.json());
  assert.equal(meta.competition.slug, 'u');
  server.close();
});

test('admin PUT competition: type-lock — 400 при попытке сменить type', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = new Database(':memory:');
  runMigrations(db);
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'shared' },
    body: JSON.stringify({
      competitions: [{ slug: 'a', title: 'A', type: 'native' }],
    }),
  });
  assert.equal(r.status, 400);
  server.close();
});
```

- [ ] **Step 2: FAIL** (visibility не сохраняется или type-lock не срабатывает)

- [ ] **Step 3: Патч `validateCompetitions`**

В `backend/src/competitions.js` находим валидатор. Внутри цикла валидации добавляем:
```js
const visibility = c.visibility === 'unlisted' ? 'unlisted' : 'public';
const type = c.type === 'native' ? 'native' : 'kaggle';
// ... в собранный объект:
return { ...rest, visibility, type };
```

Если в `validateCompetitions` уже что-то возвращается — добавь два этих поля в результат.

- [ ] **Step 4: Патч admin handler'ов**

В `app.js`:
- `POST /api/admin/competitions` — пробрасывает `validated.visibility` и `next.type` в `insertCompetition`. Уже почти так после SP-1 — проверь что `type` идёт в репо, и добавь `visibility`.
- `PUT /api/admin/competitions` — `bulkReplaceCompetitions` теперь может выбросить через `upsertCompetition` ошибку type-lock. Оборачиваем:
```js
try {
  bulkReplaceCompetitions(db, enriched);
} catch (e) {
  res.status(400).json({ error: e.message });
  return;
}
```

- [ ] **Step 5: PASS**

- [ ] **Step 6: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/competitions.js backend/src/app.js backend/tests/sp2_search.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(admin): visibility + type-lock on competitions"
```

---

## Phase 3 — Multipart upload pipeline

### Task 3.1: safeFilename helper

**Files:**
- Create: `backend/src/upload/safeFilename.js`
- Create: `backend/tests/sp2_upload.test.js`

- [ ] **Step 1: Тесты**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFilename } from '../src/upload/safeFilename.js';

test('safeFilename: keeps allowed chars', () => {
  assert.equal(safeFilename('train.csv'), 'train.csv');
  assert.equal(safeFilename('My-File_2.json'), 'My-File_2.json');
});

test('safeFilename: replaces unsafe chars with _', () => {
  assert.equal(safeFilename('foo bar baz!.csv'), 'foo_bar_baz_.csv');
  assert.equal(safeFilename('../../etc/passwd'), '_.._etc_passwd');
});

test('safeFilename: caps to 80 bytes preserving extension', () => {
  const long = 'a'.repeat(200) + '.csv';
  const out = safeFilename(long);
  assert.ok(out.length <= 80);
  assert.ok(out.endsWith('.csv'));
});

test('safeFilename: empty input → "file"', () => {
  assert.equal(safeFilename(''), 'file');
  assert.equal(safeFilename('   '), 'file');
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/upload/safeFilename.js`:
```js
const SAFE = /[^A-Za-z0-9._-]/g;

export function safeFilename(input, maxBytes = 80) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) return 'file';
  let out = trimmed.replace(SAFE, '_');
  if (out.length <= maxBytes) return out;
  const dot = out.lastIndexOf('.');
  const ext = dot > 0 ? out.slice(dot) : '';
  const base = dot > 0 ? out.slice(0, dot) : out;
  const room = Math.max(1, maxBytes - ext.length);
  return base.slice(0, room) + ext;
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/upload/safeFilename.js backend/tests/sp2_upload.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(upload): safeFilename helper"
```

---

### Task 3.2: multipartFile pipeline

**Files:**
- Create: `backend/src/upload/multipartFile.js`
- Modify: `backend/tests/sp2_upload.test.js`

- [ ] **Step 1: Тесты integration**

```js
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acceptSingleFile } from '../src/upload/multipartFile.js';

function makeUploadApp(opts) {
  const app = express();
  app.post('/upload', (req, res) => {
    acceptSingleFile(req, res, {
      maxBytes: opts.maxBytes,
      destDir: opts.destDir,
      makeFinalName: (info) => `${Date.now()}-${info.filename}`,
      onAccepted: ({ size, sha256, finalPath, originalFilename }) => {
        res.json({ size, sha256, finalPath, originalFilename });
      },
      onError: (err, status) => res.status(status || 500).json({ error: err.message }),
    });
  });
  return app;
}

async function postFile(port, content) {
  const boundary = '----X';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return fetch(`http://127.0.0.1:${port}/upload`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

test('multipart: happy path — file written, sha256 + size correct', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'));
  const app = makeUploadApp({ maxBytes: 1024, destDir: dest });
  const server = app.listen(0);
  const port = server.address().port;
  const r = await postFile(port, 'hello\n');
  const json = await r.json();
  assert.equal(json.size, 6);
  assert.equal(json.sha256, '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03');
  assert.ok(fs.existsSync(json.finalPath));
  assert.equal(fs.readFileSync(json.finalPath, 'utf8'), 'hello\n');
  server.close();
  fs.rmSync(dest, { recursive: true });
});

test('multipart: oversize — 413 + tmp cleaned', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-'));
  const app = makeUploadApp({ maxBytes: 5, destDir: dest });
  const server = app.listen(0);
  const port = server.address().port;
  const r = await postFile(port, '0123456789');
  assert.equal(r.status, 413);
  // dest пустой
  const left = fs.readdirSync(dest);
  assert.deepEqual(left.filter((f) => !f.startsWith('.')), []);
  server.close();
  fs.rmSync(dest, { recursive: true });
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/upload/multipartFile.js`:
```js
import Busboy from 'busboy';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function acceptSingleFile(req, res, opts) {
  const { maxBytes, destDir, makeFinalName, onAccepted, onError } = opts;
  const bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 1 } });
  let handled = false;
  let aborted = false;

  bb.on('file', (name, stream, info) => {
    fs.mkdirSync(destDir, { recursive: true });
    const tmpName = `.tmp-${crypto.randomUUID()}`;
    const tmpPath = path.join(destDir, tmpName);
    const sink = fs.createWriteStream(tmpPath);
    const hash = crypto.createHash('sha256');
    let size = 0;

    stream.on('data', (chunk) => {
      hash.update(chunk);
      size += chunk.length;
    });
    stream.on('limit', () => {
      aborted = true;
      sink.destroy();
      fs.rm(tmpPath, () => {});
      if (handled) return;
      handled = true;
      onError(new Error('file too large'), 413);
    });
    stream.pipe(sink);

    sink.on('finish', () => {
      if (aborted) return;
      const finalName = makeFinalName(info);
      const finalPath = path.join(destDir, finalName);
      fs.rename(tmpPath, finalPath, (err) => {
        if (err) {
          fs.rm(tmpPath, () => {});
          if (handled) return;
          handled = true;
          onError(err, 500);
          return;
        }
        if (handled) return;
        handled = true;
        onAccepted({
          size,
          sha256: hash.digest('hex'),
          finalPath,
          originalFilename: info.filename,
          mimetype: info.mimeType,
        });
      });
    });
    sink.on('error', (err) => {
      if (handled) return;
      handled = true;
      onError(err, 500);
    });
  });

  bb.on('error', (err) => {
    if (handled) return;
    handled = true;
    onError(err, 400);
  });

  bb.on('finish', () => {
    if (!handled && !aborted && size === 0) {
      handled = true;
      onError(new Error('no file in request'), 400);
    }
  });

  req.pipe(bb);
}
```

> Замечание: `size` в `bb.on('finish')` — переменная из закрытия конкретного file-handler'а; если файла не было, она не определена. Перепиши через флаг `gotFile`:

```js
let gotFile = false;
bb.on('file', (name, stream, info) => {
  gotFile = true;
  // ... остальное
});
bb.on('finish', () => {
  if (!handled && !gotFile) {
    handled = true;
    onError(new Error('no file in request'), 400);
  }
});
```

Используй этот вариант.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/upload/multipartFile.js backend/tests/sp2_upload.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(upload): multipart busboy pipeline (sha256 + atomic rename + size limit)"
```

---

## Phase 4 — Native task admin endpoints

### Task 4.1: CRUD native_tasks (без файлов)

**Files:**
- Create: `backend/src/routes/nativeTasksAdmin.js`
- Modify: `backend/src/app.js` (mount router)
- Create: `backend/tests/sp2_admin.test.js`

- [ ] **Step 1: Тесты CRUD**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';

const ADMIN_HEADERS = { 'content-type': 'application/json', 'x-admin-token': 'shared' };

function setup() {
  process.env.ADMIN_TOKEN = 'shared';
  const db = new Database(':memory:');
  runMigrations(db);
  insertCompetition(db, { slug: 'comp', title: 'Comp', type: 'native', visibility: 'public' });
  insertCompetition(db, { slug: 'kg', title: 'Kg', type: 'kaggle', visibility: 'public' });
  return { db, app: createApp({ db }) };
}

async function start(app) {
  return new Promise((r) => { const s = app.listen(0, () => r(s)); });
}

test('admin native-tasks: POST creates, GET lists, PUT updates, DELETE soft-deletes', async () => {
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;

  // POST
  const c = await fetch(base, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ slug: 't1', title: 'T1', descriptionMd: '# Hello' }),
  });
  assert.equal(c.status, 200);
  const cb = await c.json();
  assert.equal(cb.task.slug, 't1');

  // GET list
  const g = await fetch(base, { headers: ADMIN_HEADERS });
  const gb = await g.json();
  assert.equal(gb.tasks.length, 1);

  // PUT
  const u = await fetch(`${base}/t1`, {
    method: 'PUT', headers: ADMIN_HEADERS,
    body: JSON.stringify({ title: 'T1-updated', baselineScorePublic: 0.5, authorScorePublic: 0.9 }),
  });
  const ub = await u.json();
  assert.equal(ub.task.title, 'T1-updated');
  assert.equal(ub.task.baselineScorePublic, 0.5);

  // DELETE
  const d = await fetch(`${base}/t1`, { method: 'DELETE', headers: ADMIN_HEADERS });
  assert.equal(d.status, 200);
  const g2 = await fetch(base, { headers: ADMIN_HEADERS });
  const g2b = await g2.json();
  assert.equal(g2b.tasks.length, 0);
  server.close();
});

test('admin native-tasks: 404 для kaggle competition', async () => {
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/kg/native-tasks`, {
    method: 'POST', headers: ADMIN_HEADERS,
    body: JSON.stringify({ slug: 't', title: 'T' }),
  });
  assert.equal(r.status, 400); // или 404 — выбираем 400 (см. реализация)
  server.close();
});

test('admin native-tasks: duplicate slug → 400', async () => {
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const dup = await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'D' }) });
  assert.equal(dup.status, 400);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация router**

`backend/src/routes/nativeTasksAdmin.js`:
```js
import { Router } from 'express';
import { getCompetition } from '../db/competitionsRepo.js';
import {
  insertNativeTask,
  getNativeTask,
  listNativeTasks,
  updateNativeTask,
  softDeleteNativeTask,
} from '../db/nativeTasksRepo.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function requireNativeComp(db, slug) {
  const c = getCompetition(db, slug);
  if (!c) return { error: { status: 404, message: `competition '${slug}' not found` } };
  if (c.deletedAt) return { error: { status: 404, message: `competition '${slug}' is deleted` } };
  if (c.type !== 'native') return { error: { status: 400, message: `competition '${slug}' is not native` } };
  return { competition: c };
}

function validateTaskInput(b) {
  const errors = [];
  const slug = String(b?.slug || '').trim().toLowerCase();
  const title = String(b?.title || '').trim();
  if (!slug || slug.length > 64 || !SLUG_RE.test(slug)) errors.push('invalid slug');
  if (!title || title.length > 200) errors.push('invalid title');
  const descriptionMd = String(b?.descriptionMd ?? '');
  const higherIsBetter = b?.higherIsBetter !== false;
  const numeric = (k) => {
    if (b?.[k] === undefined || b?.[k] === null || b?.[k] === '') return null;
    const n = Number(b[k]);
    if (!Number.isFinite(n)) errors.push(`${k}: not a number`);
    return n;
  };
  return {
    ok: errors.length === 0,
    errors,
    data: {
      slug,
      title,
      descriptionMd,
      higherIsBetter,
      baselineScorePublic: numeric('baselineScorePublic'),
      authorScorePublic: numeric('authorScorePublic'),
      baselineScorePrivate: numeric('baselineScorePrivate'),
      authorScorePrivate: numeric('authorScorePrivate'),
    },
  };
}

export function createNativeTasksAdminRouter({ db }) {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    res.json({ tasks: listNativeTasks(db, req.params.competitionSlug) });
  });

  router.post('/', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const v = validateTaskInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });
    if (getNativeTask(db, req.params.competitionSlug, v.data.slug)) {
      return res.status(400).json({ error: `slug '${v.data.slug}' already exists` });
    }
    const task = insertNativeTask(db, { competitionSlug: req.params.competitionSlug, ...v.data });
    res.json({ task });
  });

  router.put('/:taskSlug', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const existing = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!existing) return res.status(404).json({ error: 'task not found' });
    const v = validateTaskInput({ ...existing, ...req.body, slug: existing.slug });
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });
    const { slug, ...patch } = v.data;
    const task = updateNativeTask(db, req.params.competitionSlug, req.params.taskSlug, patch);
    res.json({ task });
  });

  router.delete('/:taskSlug', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const existing = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!existing) return res.status(404).json({ error: 'task not found' });
    softDeleteNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    // (Soft-delete файла-папки на диске — Task 4.4 финализирует, в SP-2 здесь TODO-нет)
    res.json({ ok: true });
  });

  return router;
}
```

- [ ] **Step 4: Mount в `app.js`**

В `app.js`:
```js
import { createNativeTasksAdminRouter } from './routes/nativeTasksAdmin.js';
// ...
app.use('/api/admin/competitions/:competitionSlug/native-tasks', adminMw, createNativeTasksAdminRouter({ db }));
```

- [ ] **Step 5: PASS**

- [ ] **Step 6: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/nativeTasksAdmin.js backend/src/app.js backend/tests/sp2_admin.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(admin/native): CRUD native_tasks endpoints"
```

---

### Task 4.2: Upload датасет/артефакт (POST file)

**Files:**
- Modify: `backend/src/routes/nativeTasksAdmin.js`
- Modify: `backend/tests/sp2_admin.test.js`
- Modify: `backend/.env.example`

- [ ] **Step 1: Тесты загрузки файла**

```js
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

function multipartBody(filename, content, mime = 'text/csv') {
  const boundary = '----X';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="display_name"\r\n\r\nMyFile\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

test('admin native-tasks: POST file (dataset) saves on disk + row', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const { body, boundary } = multipartBody('train.csv', 'a,b\n1,2\n');
  const r = await fetch(`${base}/t/files?kind=dataset`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-admin-token': 'shared' },
    body,
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.file.kind, 'dataset');
  assert.equal(j.file.originalFilename, 'train.csv');
  assert.ok(fs.existsSync(j.file.path));
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('admin native-tasks: POST file kind=invalid → 400', async () => {
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const { body, boundary } = multipartBody('x.csv', 'x');
  const r = await fetch(`${base}/t/files?kind=BOGUS`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-admin-token': 'shared' },
    body,
  });
  assert.equal(r.status, 400);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Расширить router**

В `nativeTasksAdmin.js` добавить вверху:
```js
import path from 'node:path';
import { acceptSingleFile } from '../upload/multipartFile.js';
import { safeFilename } from '../upload/safeFilename.js';
import {
  insertPendingFile,
  commitFilePath,
  getFileById,
  deleteFileById,
  listFilesByTask,
  updateFileMetadata,
} from '../db/nativeTaskFilesRepo.js';
import { getNativeTaskById } from '../db/nativeTasksRepo.js';

const NATIVE_DATA_DIR = () => path.resolve(process.env.NATIVE_DATA_DIR || './data/native');

function maxBytesFor(kind) {
  if (kind === 'dataset') return Number(process.env.MAX_DATASET_BYTES || 524288000);
  if (kind === 'artifact') return Number(process.env.MAX_ARTIFACT_BYTES || 26214400);
  return 0;
}

function fileDir(comp, task, kind) {
  return path.join(NATIVE_DATA_DIR(), comp, task, kind);
}
```

И endpoint:
```js
router.post('/:taskSlug/files', (req, res) => {
  const r = requireNativeComp(db, req.params.competitionSlug);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
  if (!task) return res.status(404).json({ error: 'task not found' });
  const kind = req.query.kind;
  if (kind !== 'dataset' && kind !== 'artifact') {
    return res.status(400).json({ error: "kind must be 'dataset' or 'artifact'" });
  }
  const destDir = fileDir(req.params.competitionSlug, req.params.taskSlug, kind);
  const maxBytes = maxBytesFor(kind);

  let fileRowId = null;
  acceptSingleFile(req, res, {
    maxBytes,
    destDir,
    makeFinalName: (info) => {
      // имя — pending row сначала; финальное имя после insertPending
      // здесь возвращаем временное .pending- → переименуем после insertPending
      return `.pending-${Date.now()}-${safeFilename(info.filename)}`;
    },
    onAccepted: ({ size, sha256, finalPath, originalFilename }) => {
      // Мы сейчас имеем файл на диске под .pending- именем. Insert строку, потом переименуем.
      const displayName = String(req.body?.display_name || originalFilename);
      const description = String(req.body?.description || '');
      const row = insertPendingFile(db, {
        taskId: task.id,
        kind,
        displayName,
        description,
        originalFilename,
        sizeBytes: size,
        sha256,
      });
      fileRowId = row.id;
      const finalName = `${row.id}-${safeFilename(originalFilename)}`;
      const targetPath = path.join(destDir, finalName);
      import('node:fs/promises').then((fsp) =>
        fsp.rename(finalPath, targetPath)
          .then(() => {
            commitFilePath(db, row.id, targetPath);
            res.json({ file: getFileById(db, row.id) });
          })
          .catch((e) => {
            deleteFileById(db, row.id);
            fsp.rm(finalPath, { force: true }).catch(() => {});
            res.status(500).json({ error: e.message });
          })
      );
    },
    onError: (err, status) => res.status(status || 500).json({ error: err.message }),
  });
});
```

> Замечание: `req.body` тут может быть пустым потому что busboy не парсит form-fields для тебя автоматически в этом setup'e. Простое решение: парсить `display_name`/`description` из multipart полей внутри `acceptSingleFile`. Расширь `multipartFile.js`:

```js
// в acceptSingleFile:
const fields = {};
bb.on('field', (name, val) => { fields[name] = val; });
// в onAccepted прокидывай fields:
onAccepted({ size, sha256, finalPath, originalFilename, mimetype, fields });
```

И в endpoint используй `info.fields.display_name` (поправь сигнатуру тестов соответственно — `display_name` приходит как form-field).

- [ ] **Step 4: PASS**

- [ ] **Step 5: Update `.env.example`**

```ini
# SP-2: native data
NATIVE_DATA_DIR=./data/native
MAX_DATASET_BYTES=524288000
MAX_ARTIFACT_BYTES=26214400
MAX_GRADER_BYTES=102400
MAX_GROUND_TRUTH_BYTES=524288000
```

- [ ] **Step 6: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/nativeTasksAdmin.js backend/src/upload/multipartFile.js backend/.env.example backend/tests/sp2_admin.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(admin/native): POST upload dataset/artifact file"
```

---

### Task 4.3: PUT/DELETE file metadata + content removal

**Files:**
- Modify: `backend/src/routes/nativeTasksAdmin.js`
- Modify: `backend/tests/sp2_admin.test.js`

- [ ] **Step 1: Тесты**

```js
test('admin native-tasks: PUT file updates metadata', async () => {
  // setup → upload → PUT /files/:id { displayName, description, displayOrder }
  // expect file row updated
});

test('admin native-tasks: DELETE file removes row + disk file', async () => {
  // setup → upload → DELETE /files/:id → expect row gone + path gone
});
```

(Тестовые тела пишутся аналогично Task 4.2 — см. для образца.)

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Endpoints**

```js
router.put('/:taskSlug/files/:fileId', (req, res) => {
  const r = requireNativeComp(db, req.params.competitionSlug);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  const file = getFileById(db, Number(req.params.fileId));
  if (!file) return res.status(404).json({ error: 'file not found' });
  const patch = {};
  if ('displayName' in req.body) patch.displayName = String(req.body.displayName).trim();
  if ('description' in req.body) patch.description = String(req.body.description);
  if ('displayOrder' in req.body) patch.displayOrder = Number(req.body.displayOrder) || 0;
  const updated = updateFileMetadata(db, file.id, patch);
  res.json({ file: updated });
});

router.delete('/:taskSlug/files/:fileId', async (req, res) => {
  const r = requireNativeComp(db, req.params.competitionSlug);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  const file = getFileById(db, Number(req.params.fileId));
  if (!file) return res.status(404).json({ error: 'file not found' });
  deleteFileById(db, file.id);
  try {
    const fs = await import('node:fs/promises');
    await fs.rm(file.path, { force: true });
  } catch (e) {
    console.warn(`[delete file] disk cleanup failed: ${e.message}`);
  }
  res.json({ ok: true });
});
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/nativeTasksAdmin.js backend/tests/sp2_admin.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(admin/native): PUT/DELETE files (metadata + remove)"
```

---

### Task 4.4: Grader + Ground-truth (single-file slots)

**Files:**
- Modify: `backend/src/routes/nativeTasksAdmin.js`
- Modify: `backend/tests/sp2_admin.test.js`

- [ ] **Step 1: Тесты**

```js
test('admin native-tasks: PUT grader uploads + writes grader_path; replaces previous file', async () => {
  // setup → PUT /grader → assert task.graderPath set + file exists
  // PUT again → previous file deleted, new file in place
});

test('admin native-tasks: DELETE grader → grader_path = null + file gone', async () => {});

test('admin native-tasks: ground-truth path same shape', async () => {});

test('admin native-tasks: PUT grader exceeds MAX_GRADER_BYTES → 413', async () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

```js
function singleSlotEndpoint(slot, columnPathField, maxEnvKey) {
  // slot ∈ { 'grader', 'ground-truth' }
  return (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const taskDir = path.join(NATIVE_DATA_DIR(), req.params.competitionSlug, req.params.taskSlug);
    const maxBytes = Number(process.env[maxEnvKey] || (slot === 'grader' ? 102400 : 524288000));
    acceptSingleFile(req, res, {
      maxBytes,
      destDir: taskDir,
      makeFinalName: (info) => `.pending-${Date.now()}-${safeFilename(info.filename)}`,
      onAccepted: async ({ finalPath, originalFilename }) => {
        const ext = path.extname(originalFilename) || '';
        const target = path.join(taskDir, `${slot.replace('-', '_')}${ext}`); // grader.py / ground_truth.csv
        try {
          const fs = await import('node:fs/promises');
          // удалить предыдущий, если есть
          const prev = task[columnPathField + ('Path')];
          // task.graderPath / task.groundTruthPath
          const prevPath = slot === 'grader' ? task.graderPath : task.groundTruthPath;
          if (prevPath) await fs.rm(prevPath, { force: true });
          await fs.rename(finalPath, target);
          updateNativeTask(db, req.params.competitionSlug, req.params.taskSlug,
            slot === 'grader' ? { graderPath: target } : { groundTruthPath: target }
          );
          res.json({ ok: true, path: target });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      },
      onError: (err, status) => res.status(status || 500).json({ error: err.message }),
    });
  };
}

router.put('/:taskSlug/grader', singleSlotEndpoint('grader', 'grader', 'MAX_GRADER_BYTES'));
router.put('/:taskSlug/ground-truth', singleSlotEndpoint('ground-truth', 'groundTruth', 'MAX_GROUND_TRUTH_BYTES'));

router.delete('/:taskSlug/grader', async (req, res) => {
  const r = requireNativeComp(db, req.params.competitionSlug);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.graderPath) {
    const fs = await import('node:fs/promises');
    await fs.rm(task.graderPath, { force: true }).catch(() => {});
  }
  updateNativeTask(db, req.params.competitionSlug, req.params.taskSlug, { graderPath: null });
  res.json({ ok: true });
});

router.delete('/:taskSlug/ground-truth', async (req, res) => {
  const r = requireNativeComp(db, req.params.competitionSlug);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.groundTruthPath) {
    const fs = await import('node:fs/promises');
    await fs.rm(task.groundTruthPath, { force: true }).catch(() => {});
  }
  updateNativeTask(db, req.params.competitionSlug, req.params.taskSlug, { groundTruthPath: null });
  res.json({ ok: true });
});
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/nativeTasksAdmin.js backend/tests/sp2_admin.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(admin/native): PUT/DELETE grader + ground-truth slots"
```

---

## Phase 5 — Public endpoints + leaderboard dispatch

### Task 5.1: GET task + список + детали

**Files:**
- Create: `backend/src/routes/nativeTasksPublic.js`
- Modify: `backend/src/app.js`
- Create: `backend/tests/sp2_public.test.js`

- [ ] **Step 1: Тесты**

```js
test('public: GET /api/competitions/<slug>/tasks/<task> returns task + datasets[] + artifacts[] (no grader_path)', async () => {});
test('public: GET task returns 404 for non-existent task', async () => {});
test('public: GET task returns 404 for kaggle competition (kaggle path uses different endpoint)', async () => {});
```

(Тестовые тела пишутся через `setup()` + upload файлов аналогично admin тестам.)

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/routes/nativeTasksPublic.js`:
```js
import { Router } from 'express';
import { getCompetition } from '../db/competitionsRepo.js';
import { getNativeTask, listNativeTasks } from '../db/nativeTasksRepo.js';
import { listFilesByTask } from '../db/nativeTaskFilesRepo.js';

function stripPrivate(file) {
  // не возвращаем `path` наружу — только метаданные + id для скачивания через /files/:id
  return {
    id: file.id,
    kind: file.kind,
    displayName: file.displayName,
    description: file.description,
    originalFilename: file.originalFilename,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    displayOrder: file.displayOrder,
    uploadedAt: file.uploadedAt,
  };
}

function publicTask(task, files) {
  if (!task) return null;
  const datasets = files.filter((f) => f.kind === 'dataset').map(stripPrivate);
  const artifacts = files.filter((f) => f.kind === 'artifact').map(stripPrivate);
  return {
    slug: task.slug,
    title: task.title,
    descriptionMd: task.descriptionMd,
    higherIsBetter: task.higherIsBetter,
    baselineScorePublic: task.baselineScorePublic,
    authorScorePublic: task.authorScorePublic,
    baselineScorePrivate: task.baselineScorePrivate,
    authorScorePrivate: task.authorScorePrivate,
    datasets,
    artifacts,
  };
}

export function createNativeTasksPublicRouter({ db }) {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt) return res.status(404).json({ error: 'competition not found' });
    if (c.type !== 'native') return res.status(404).json({ error: 'not a native competition' });
    res.json({ tasks: listNativeTasks(db, req.params.competitionSlug).map((t) => ({
      slug: t.slug,
      title: t.title,
      higherIsBetter: t.higherIsBetter,
    })) });
  });

  router.get('/:taskSlug', (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt || c.type !== 'native') {
      return res.status(404).json({ error: 'not found' });
    }
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const files = listFilesByTask(db, task.id);
    res.json({ task: publicTask(task, files), updatedAt: task.createdAt });
  });

  return router;
}
```

И в `app.js`:
```js
import { createNativeTasksPublicRouter } from './routes/nativeTasksPublic.js';
app.use('/api/competitions/:competitionSlug/native-tasks', createNativeTasksPublicRouter({ db }));
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/nativeTasksPublic.js backend/src/app.js backend/tests/sp2_public.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(public/native): GET tasks + task detail (without grader path)"
```

---

### Task 5.2: GET файла (стрим)

**Files:**
- Modify: `backend/src/routes/nativeTasksPublic.js`
- Modify: `backend/tests/sp2_public.test.js`

- [ ] **Step 1: Тесты**

```js
test('public: GET file streams content for logged-in user', async () => {});
test('public: GET file 401 for anonymous', async () => {});
test('public: GET file 404 for grader (kind not in dataset/artifact)', async () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Endpoint**

В `nativeTasksPublic.js`:
```js
import { getFileById } from '../db/nativeTaskFilesRepo.js';
import { requireAuth } from '../auth/middleware.js';

router.get('/:taskSlug/files/:fileId', requireAuth, (req, res) => {
  const c = getCompetition(db, req.params.competitionSlug);
  if (!c || c.deletedAt || c.type !== 'native') return res.status(404).json({ error: 'not found' });
  const file = getFileById(db, Number(req.params.fileId));
  if (!file) return res.status(404).json({ error: 'file not found' });
  if (file.kind !== 'dataset' && file.kind !== 'artifact') return res.status(404).json({ error: 'file not found' });
  res.setHeader('Content-Disposition', `attachment; filename="${file.originalFilename}"`);
  res.setHeader('Content-Length', String(file.sizeBytes));
  res.sendFile(file.path);
});
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/nativeTasksPublic.js backend/tests/sp2_public.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(public/native): GET file stream (auth-gated)"
```

---

### Task 5.3: ZIP-стрим

**Files:**
- Create: `backend/src/upload/zipStream.js`
- Modify: `backend/src/routes/nativeTasksPublic.js`
- Modify: `backend/tests/sp2_public.test.js`

- [ ] **Step 1: Тесты**

```js
import AdmZip from 'adm-zip';

test('public: GET .zip bundles all files of given kind', async () => {
  // upload 2 datasets → GET .../files.zip?kind=dataset → AdmZip().extract → 2 files
});

test('public: GET .zip 404 if kind has no files', async () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: zipStream helper + endpoint**

`backend/src/upload/zipStream.js`:
```js
import archiver from 'archiver';

export function streamZip(files, res, basename) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${basename}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => res.destroy(err));
  archive.pipe(res);
  for (const f of files) {
    archive.file(f.path, { name: f.originalFilename });
  }
  archive.finalize();
}
```

В `nativeTasksPublic.js`:
```js
import { listFilesByTask } from '../db/nativeTaskFilesRepo.js';
import { streamZip } from '../upload/zipStream.js';

router.get('/:taskSlug/files.zip', requireAuth, (req, res) => {
  const c = getCompetition(db, req.params.competitionSlug);
  if (!c || c.deletedAt || c.type !== 'native') return res.status(404).json({ error: 'not found' });
  const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
  if (!task) return res.status(404).json({ error: 'task not found' });
  const kind = req.query.kind;
  if (kind !== 'dataset' && kind !== 'artifact') return res.status(400).json({ error: 'kind required' });
  const files = listFilesByTask(db, task.id, kind);
  if (!files.length) return res.status(404).json({ error: 'no files' });
  streamZip(files, res, `${req.params.taskSlug}-${kind}`);
});
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/upload/zipStream.js backend/src/routes/nativeTasksPublic.js backend/tests/sp2_public.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(public/native): GET files.zip bundle stream"
```

---

### Task 5.4: Leaderboard dispatch для native

**Files:**
- Modify: `backend/src/app.js`

- [ ] **Step 1: Тест**

```js
test('GET /api/competitions/<native>/leaderboard returns native tasks (entries empty in SP-2)', async () => {
  // setup native + create task → GET /leaderboard → tasks[0].slug === 't' && entries === []
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Патч `app.js`**

В обработчике `GET /api/competitions/:slug/leaderboard`, после получения `meta`:
```js
if (meta.type === 'native') {
  const nativeTasks = listNativeTasks(db, meta.slug);
  const taskMetas = nativeTasks.map((t) => ({
    slug: t.slug,
    title: t.title,
    higherIsBetter: t.higherIsBetter,
    baselineScorePublic: t.baselineScorePublic,
    authorScorePublic: t.authorScorePublic,
    baselineScorePrivate: t.baselineScorePrivate,
    authorScorePrivate: t.authorScorePrivate,
  }));
  res.json({
    updatedAt: null,
    tasks: taskMetas,
    overall: [],
    privateOverall: [],
    privateByTask: {},
    privateTaskSlugs: [],
    oursOverall: [],
    oursByTask: {},
    oursPrivateOverall: [],
    oursPrivateByTask: {},
    errors: [],
  });
  return;
}
// иначе старый kaggle-путь
```

Импорт `listNativeTasks` в шапке.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/app.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): leaderboard dispatch by competition.type"
```

---

## Phase 6 — Frontend

### Task 6.1: api.js — search + native-tasks helpers

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Расширить `api.js`**

В конец файла:
```js
export const competitions = {
  list: (q) => request(`/competitions${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (slug) => request(`/competitions/${slug}`),
  getLeaderboard: (slug) => request(`/competitions/${slug}/leaderboard`),
};

export const nativeTasks = {
  listPublic: (compSlug) => request(`/competitions/${compSlug}/native-tasks`),
  getPublic: (compSlug, taskSlug) => request(`/competitions/${compSlug}/native-tasks/${taskSlug}`),
  fileUrl: (compSlug, taskSlug, fileId) =>
    `${API_BASE}/competitions/${compSlug}/native-tasks/${taskSlug}/files/${fileId}`,
  zipUrl: (compSlug, taskSlug, kind) =>
    `${API_BASE}/competitions/${compSlug}/native-tasks/${taskSlug}/files.zip?kind=${kind}`,
};

export const adminNativeTasks = {
  list: (compSlug) => request(`/admin/competitions/${compSlug}/native-tasks`),
  create: (compSlug, body) => request(`/admin/competitions/${compSlug}/native-tasks`, { method: 'POST', body: JSON.stringify(body) }),
  update: (compSlug, taskSlug, body) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (compSlug, taskSlug) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}`, { method: 'DELETE' }),
  uploadFile: (compSlug, taskSlug, kind, formData) => {
    return fetch(`${API_BASE}/admin/competitions/${compSlug}/native-tasks/${taskSlug}/files?kind=${kind}`, {
      method: 'POST', credentials: 'include', body: formData,
    }).then(async (r) => {
      if (!r.ok) throw Object.assign(new Error((await r.json()).error || r.statusText), { status: r.status });
      return r.json();
    });
  },
  updateFile: (compSlug, taskSlug, fileId, body) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/files/${fileId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteFile: (compSlug, taskSlug, fileId) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/files/${fileId}`, { method: 'DELETE' }),
  uploadGrader: (compSlug, taskSlug, formData) => fetch(`${API_BASE}/admin/competitions/${compSlug}/native-tasks/${taskSlug}/grader`, { method: 'PUT', credentials: 'include', body: formData }).then((r) => r.json()),
  uploadGroundTruth: (compSlug, taskSlug, formData) => fetch(`${API_BASE}/admin/competitions/${compSlug}/native-tasks/${taskSlug}/ground-truth`, { method: 'PUT', credentials: 'include', body: formData }).then((r) => r.json()),
};
```

- [ ] **Step 2: Smoke**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/api.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/api): competitions search + native tasks helpers"
```

---

### Task 6.2: CompetitionsListPage — поиск

**Files:**
- Modify: `frontend/src/CompetitionsListPage.jsx`

- [ ] **Step 1: Добавить input + debounced fetch**

```jsx
import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { competitions } from './api.js';

export default function CompetitionsListPage() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);

  function refetch(query) {
    setLoading(true);
    competitions.list(query).then((r) => { setItems(r.competitions); setLoading(false); });
  }

  useEffect(() => { refetch(''); }, []);

  function onChange(e) {
    const v = e.target.value;
    setQ(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => refetch(v), 300);
  }

  return (
    <div className="competitions-list">
      <header><h1>Соревнования</h1></header>
      <input
        type="search"
        value={q}
        onChange={onChange}
        placeholder="Поиск по названию"
        className="search-input"
      />
      {loading ? (
        <div>Загрузка…</div>
      ) : items.length === 0 ? (
        <div>Ничего не найдено{q ? ` по «${q}»` : ''}</div>
      ) : (
        <ul className="competitions-grid">
          {items.map((c) => (
            <li key={c.slug}>
              <Link to={`/competitions/${c.slug}`}>
                <h2>{c.title}</h2>
                {c.subtitle && <p>{c.subtitle}</p>}
                <span className="badge">{c.type}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

В `styles.css` добавить базовые стили для `.search-input`, `.competitions-grid`, `.badge` (минимальные).

- [ ] **Step 2: Smoke в браузере**

```bash
cd frontend && npm run dev
```
В UI: вводишь «neo» — список фильтруется до соревнований с «NEO» в title.

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/CompetitionsListPage.jsx frontend/src/styles.css
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe): CompetitionsListPage with search"
```

---

### Task 6.3: MarkdownView + MarkdownEditor

**Files:**
- Create: `frontend/src/markdown/MarkdownView.jsx`, `frontend/src/markdown/MarkdownEditor.jsx`

- [ ] **Step 1: MarkdownView**

```jsx
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export default function MarkdownView({ children }) {
  return (
    <div className="markdown">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{children || ''}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 2: MarkdownEditor (textarea + live preview)**

```jsx
import { useState } from 'react';
import MarkdownView from './MarkdownView.jsx';

export default function MarkdownEditor({ value, onChange }) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="md-editor">
      <div className="md-editor-toolbar">
        <button type="button" onClick={() => setPreview(false)} disabled={!preview}>Edit</button>
        <button type="button" onClick={() => setPreview(true)} disabled={preview}>Preview</button>
      </div>
      {preview ? (
        <MarkdownView>{value}</MarkdownView>
      ) : (
        <textarea
          rows={20}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="md-editor-textarea"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Smoke (build)**

```bash
cd frontend && npm run build
```

- [ ] **Step 4: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/markdown
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/md): MarkdownView (sanitized) + MarkdownEditor (preview toggle)"
```

---

### Task 6.4: NativeTaskPage + NativeTaskFiles

**Files:**
- Create: `frontend/src/native/NativeTaskPage.jsx`, `frontend/src/native/NativeTaskFiles.jsx`

- [ ] **Step 1: NativeTaskFiles**

```jsx
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { nativeTasks } from '../api.js';

function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

export default function NativeTaskFiles({ files, kind, compSlug, taskSlug }) {
  const { user } = useAuth();
  if (!files.length) return <p>Файлов нет</p>;
  const filesOfKind = files;
  return (
    <div>
      <table className="file-table">
        <thead><tr><th>Имя</th><th>Размер</th><th>Действие</th></tr></thead>
        <tbody>
          {filesOfKind.map((f) => (
            <tr key={f.id}>
              <td>{f.displayName}{f.description ? <span className="dim"> — {f.description}</span> : null}</td>
              <td>{fmtSize(f.sizeBytes)}</td>
              <td>{user ? (
                <a href={nativeTasks.fileUrl(compSlug, taskSlug, f.id)}>Скачать</a>
              ) : (
                <Link to="/login">Войти для скачивания</Link>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {user && filesOfKind.length > 1 && (
        <p><a href={nativeTasks.zipUrl(compSlug, taskSlug, kind)}>Скачать все zip</a></p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: NativeTaskPage**

```jsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { nativeTasks } from '../api.js';
import MarkdownView from '../markdown/MarkdownView.jsx';
import NativeTaskFiles from './NativeTaskFiles.jsx';

export default function NativeTaskPage() {
  const { competitionSlug, taskSlug } = useParams();
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    nativeTasks.getPublic(competitionSlug, taskSlug)
      .then((r) => setTask(r.task))
      .catch((e) => setError(e.message));
  }, [competitionSlug, taskSlug]);

  if (error) return <div className="error">{error}</div>;
  if (!task) return <div>Загрузка…</div>;

  return (
    <div className="native-task">
      <h1>{task.title}</h1>
      <section><MarkdownView>{task.descriptionMd}</MarkdownView></section>
      <section>
        <h2>Данные</h2>
        <NativeTaskFiles files={task.datasets} kind="dataset" compSlug={competitionSlug} taskSlug={taskSlug} />
      </section>
      <section>
        <h2>Стартовый набор</h2>
        <NativeTaskFiles files={task.artifacts} kind="artifact" compSlug={competitionSlug} taskSlug={taskSlug} />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Mount route в `App.jsx`**

```jsx
import NativeTaskPage from './native/NativeTaskPage.jsx';
// ...
<Route path="/competitions/:competitionSlug/native-tasks/:taskSlug" element={<NativeTaskPage />} />
```

- [ ] **Step 4: Smoke**

```bash
cd frontend && npm run dev
```
Создать через админку native задачу, открыть `/competitions/<slug>/native-tasks/<task-slug>`. Проверить что markdown рендерится, файлы видны, скачивание работает.

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/native frontend/src/App.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe): NativeTaskPage public view + files component"
```

---

### Task 6.5: AdminCompetitionsPage — visibility radio + type-lock indicator

**Files:**
- Modify: `frontend/src/admin/AdminCompetitionsPage.jsx`

- [ ] **Step 1: Patch form**

В форме создания/редактирования соревнования добавить:
```jsx
<fieldset>
  <legend>Видимость</legend>
  <label><input type="radio" name="visibility" value="public" checked={form.visibility === 'public'} onChange={() => setForm({ ...form, visibility: 'public' })} /> Public — в каталоге + поиск</label>
  <label><input type="radio" name="visibility" value="unlisted" checked={form.visibility === 'unlisted'} onChange={() => setForm({ ...form, visibility: 'unlisted' })} /> Unlisted — только по ссылке</label>
</fieldset>
```

В режиме edit для type-radio добавить `disabled` если `isEditing`:
```jsx
<fieldset disabled={isEditing}>
  <legend>Тип {isEditing && <span className="dim">(нельзя поменять после создания)</span>}</legend>
  <label><input type="radio" ... /> Kaggle</label>
  <label><input type="radio" ... /> Native</label>
</fieldset>
```

В таблице соревнований добавить столбец «Видимость» рядом со «Тип».

В пейлоад на POST/PUT добавить `visibility: form.visibility`.

- [ ] **Step 2: Smoke в браузере**

Создаёт public, unlisted, native, kaggle — все формы работают.

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/admin/AdminCompetitionsPage.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/admin): visibility radio + type-lock on edit"
```

---

### Task 6.6: AdminNativeTasksList + AdminNativeTaskEdit

**Files:**
- Create: `frontend/src/admin/AdminNativeTasksList.jsx`, `frontend/src/admin/AdminNativeTaskEdit.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: AdminNativeTasksList**

```jsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminNativeTasks } from '../api.js';

export default function AdminNativeTasksList() {
  const { competitionSlug } = useParams();
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);

  function refresh() {
    adminNativeTasks.list(competitionSlug).then((r) => setTasks(r.tasks)).catch((e) => setError(e.message));
  }
  useEffect(() => { refresh(); }, [competitionSlug]);

  async function onCreate() {
    const slug = prompt('Slug новой задачи (a-z, 0-9, дефисы):');
    if (!slug) return;
    const title = prompt('Title:');
    if (!title) return;
    await adminNativeTasks.create(competitionSlug, { slug, title });
    refresh();
  }

  async function onDelete(slug) {
    if (!confirm(`Удалить задачу '${slug}'? (soft delete)`)) return;
    await adminNativeTasks.delete(competitionSlug, slug);
    refresh();
  }

  return (
    <div>
      <header>
        <h1>Задачи (native): {competitionSlug}</h1>
        <button onClick={onCreate}>+ Создать</button>
      </header>
      {error && <div className="error">{error}</div>}
      <table>
        <thead><tr><th>Slug</th><th>Title</th><th></th></tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.slug}>
              <td><Link to={`/admin/competitions/${competitionSlug}/native-tasks/${t.slug}`}>{t.slug}</Link></td>
              <td>{t.title}</td>
              <td><button onClick={() => onDelete(t.slug)}>Удалить</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: AdminNativeTaskEdit (разом — метаданные + файлы)**

Это большой компонент; разделим внутри на секции. Полный код:

```jsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminNativeTasks, nativeTasks } from '../api.js';
import MarkdownEditor from '../markdown/MarkdownEditor.jsx';

export default function AdminNativeTaskEdit() {
  const { competitionSlug, taskSlug } = useParams();
  const [task, setTask] = useState(null);
  const [files, setFiles] = useState({ datasets: [], artifacts: [] });
  const [error, setError] = useState(null);

  async function load() {
    const t = await adminNativeTasks.list(competitionSlug);
    const found = t.tasks.find((x) => x.slug === taskSlug);
    if (!found) return setError('Task not found');
    setTask(found);
    const pub = await nativeTasks.getPublic(competitionSlug, taskSlug);
    setFiles({ datasets: pub.task.datasets, artifacts: pub.task.artifacts });
  }
  useEffect(() => { load(); }, [competitionSlug, taskSlug]);

  async function saveMeta() {
    await adminNativeTasks.update(competitionSlug, taskSlug, {
      title: task.title,
      descriptionMd: task.descriptionMd,
      higherIsBetter: task.higherIsBetter,
      baselineScorePublic: task.baselineScorePublic,
      authorScorePublic: task.authorScorePublic,
      baselineScorePrivate: task.baselineScorePrivate,
      authorScorePrivate: task.authorScorePrivate,
    });
    alert('Сохранено');
  }

  async function uploadFile(kind, file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('display_name', file.name);
    await adminNativeTasks.uploadFile(competitionSlug, taskSlug, kind, fd);
    load();
  }

  async function uploadSlot(kind, file) {
    const fd = new FormData();
    fd.append('file', file);
    if (kind === 'grader') await adminNativeTasks.uploadGrader(competitionSlug, taskSlug, fd);
    else await adminNativeTasks.uploadGroundTruth(competitionSlug, taskSlug, fd);
    alert(`${kind} загружен`);
  }

  if (error) return <div className="error">{error}</div>;
  if (!task) return <div>Загрузка…</div>;

  return (
    <div>
      <h1>Задача: {task.slug}</h1>
      <section>
        <label>Title <input value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} /></label>
        <label>Описание (markdown):
          <MarkdownEditor value={task.descriptionMd} onChange={(v) => setTask({ ...task, descriptionMd: v })} />
        </label>
        <fieldset>
          <legend>Scoring</legend>
          <label>baseline public: <input type="number" step="any" value={task.baselineScorePublic ?? ''} onChange={(e) => setTask({ ...task, baselineScorePublic: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label>author public: <input type="number" step="any" value={task.authorScorePublic ?? ''} onChange={(e) => setTask({ ...task, authorScorePublic: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label>baseline private: <input type="number" step="any" value={task.baselineScorePrivate ?? ''} onChange={(e) => setTask({ ...task, baselineScorePrivate: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label>author private: <input type="number" step="any" value={task.authorScorePrivate ?? ''} onChange={(e) => setTask({ ...task, authorScorePrivate: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label><input type="checkbox" checked={task.higherIsBetter} onChange={(e) => setTask({ ...task, higherIsBetter: e.target.checked })} /> Higher is better</label>
        </fieldset>
        <button onClick={saveMeta}>Сохранить метаданные</button>
      </section>

      <section>
        <h2>Датасеты</h2>
        <input type="file" onChange={(e) => e.target.files[0] && uploadFile('dataset', e.target.files[0])} />
        <ul>{files.datasets.map((f) => <li key={f.id}>{f.displayName} ({f.sizeBytes} B)</li>)}</ul>
      </section>

      <section>
        <h2>Стартовый набор</h2>
        <input type="file" onChange={(e) => e.target.files[0] && uploadFile('artifact', e.target.files[0])} />
        <ul>{files.artifacts.map((f) => <li key={f.id}>{f.displayName} ({f.sizeBytes} B)</li>)}</ul>
      </section>

      <section>
        <h2>Grader (score.py)</h2>
        <p>Текущий: {task.graderPath || '(нет)'}</p>
        <input type="file" accept=".py" onChange={(e) => e.target.files[0] && uploadSlot('grader', e.target.files[0])} />
      </section>

      <section>
        <h2>Ground truth</h2>
        <p>Текущий: {task.groundTruthPath || '(нет)'}</p>
        <input type="file" onChange={(e) => e.target.files[0] && uploadSlot('groundTruth', e.target.files[0])} />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Mount routes в `App.jsx`**

```jsx
import AdminNativeTasksList from './admin/AdminNativeTasksList.jsx';
import AdminNativeTaskEdit from './admin/AdminNativeTaskEdit.jsx';
// ...
<Route path="/admin/competitions/:competitionSlug/native-tasks" element={<AdminNativeTasksList />} />
<Route path="/admin/competitions/:competitionSlug/native-tasks/:taskSlug" element={<AdminNativeTaskEdit />} />
```

- [ ] **Step 4: Smoke**

Open /admin/competitions/<native-slug>/native-tasks → создать задачу → открыть редактор → ввести описание (preview), загрузить датасет, артефакт, grader.py, ground-truth.csv → сохранить.

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/admin frontend/src/App.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/admin): AdminNativeTasksList + AdminNativeTaskEdit"
```

---

## Phase 7 — Smoke + docs

### Task 7.1: End-to-end smoke

- [ ] **Step 1: Чистая БД**

```bash
cd backend
rm -f data/app.db
ADMIN_BOOTSTRAP_EMAIL=root@x.y ADMIN_BOOTSTRAP_PASSWORD=hunter2hunter2 npm run dev
```

- [ ] **Step 2: Создать native соревнование через админку**

В UI: `/admin/competitions` → POST native + public → видно в `/`.

- [ ] **Step 3: Создать задачу + загрузить файлы**

`/admin/competitions/sandbox/native-tasks` → создать `t1` → редактор → markdown «# Hello», загрузить small.csv (dataset), starter.ipynb (artifact), score.py (grader), gt.csv (ground-truth).

- [ ] **Step 4: Анон видит описание + 401 на скачивание**

`/competitions/sandbox/native-tasks/t1` (без логина) → описание видно, кнопка «Скачать» — идёт на login.

- [ ] **Step 5: Залогиненный участник скачивает файлы**

Логин → скачивание датасета успешно, грейдер недоступен (404 даже если знать id).

- [ ] **Step 6: Тесты зелёные**

```bash
cd backend && npm test
```

- [ ] **Step 7: Smoke commit (нечего коммитить, только проверки)**

---

### Task 7.2: Update README + ROUTES.md

**Files:**
- Modify: `new_lb/README.md`, `new_lb/ROUTES.md`

- [ ] **Step 1: README**

Добавить новые ENV в таблицу (`NATIVE_DATA_DIR`, `MAX_DATASET_BYTES`, etc.). В секцию «Локальная разработка» дописать про `data/native/` поддиректорию для нативных файлов.

- [ ] **Step 2: ROUTES.md**

Добавить секции:
- Public: `/api/competitions?q=`, `/api/competitions/<slug>/native-tasks`, `…/native-tasks/<task>`, `…/files/:fileId`, `…/files.zip?kind=`
- Admin: `…/native-tasks` POST/PUT/DELETE, `…/native-tasks/<task>/files` POST/PUT/DELETE, `…/grader`, `…/ground-truth`
- В таблице полей соревнования добавить `visibility: 'public' | 'unlisted'`

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add new_lb/README.md new_lb/ROUTES.md
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "docs(sp2): native task admin + visibility + search"
```

---

## Self-review

**Spec coverage:**
- ✓ Migration 0002 (visibility + native tables) — Task 1.1
- ✓ Repos: nativeTasks, nativeTaskFiles, competitions extension — Tasks 1.2–1.4
- ✓ Search endpoint + visibility filter — Task 2.1
- ✓ validateCompetitions visibility + type-lock — Task 2.2
- ✓ safeFilename — Task 3.1
- ✓ Multipart pipeline — Task 3.2
- ✓ Admin CRUD native_tasks — Task 4.1
- ✓ Admin file upload (dataset/artifact) — Task 4.2
- ✓ Admin file metadata + delete — Task 4.3
- ✓ Grader + ground-truth slots — Task 4.4
- ✓ Public list/detail (без grader_path) — Task 5.1
- ✓ Public file stream (auth) — Task 5.2
- ✓ Public zip stream — Task 5.3
- ✓ Leaderboard dispatch native — Task 5.4
- ✓ api.js helpers — Task 6.1
- ✓ Search input на главной — Task 6.2
- ✓ MarkdownView/Editor — Task 6.3
- ✓ NativeTaskPage (public) — Task 6.4
- ✓ Admin visibility radio + type-lock UI — Task 6.5
- ✓ Admin native-tasks pages — Task 6.6
- ✓ Smoke — Task 7.1
- ✓ Docs — Task 7.2

**Plan check:** placeholder'ов нет. Имена методов сквозные: `insertNativeTask`/`getNativeTask`/`updateNativeTask`/`softDeleteNativeTask` — везде; `insertPendingFile`/`commitFilePath`/`getFileById`/`listFilesByTask` — везде; `acceptSingleFile` — везде.

**Заранее предвижу tricky:** Task 4.2 — порядок «pending row → rename» имеет race-условие если два upload'a уносят одинаковые имена. Решение: `.pending-<uuid>-` префикс на промежуточном файле + `<id>-<safe-name>` финальное имя — `id` всегда уникален, гарантирует unique path. Тесты на конкурентность пока не пишем (одиночный admin в SP-2).

---

## Critical paths to remember

- **Не сломать kaggle-flow.** `competition.type` — единственный switch; native — отдельный код. Существующий `neoai-2026` после миграции 0002 получит `visibility='public'` (т.к. `visible=1` в SP-1) и продолжит работать через kaggle-путь.
- **Type-lock в `upsertCompetition`.** PUT bulk-replace из SP-1 теперь ВЫБРАСЫВАЕТ ошибку при попытке сменить `type` на существующем slug. Проверить что фронт-код, который рассылает PUT с массивом, не теряется на этом — нужно ловить 400 и показывать сообщение пользователю.
- **`req.body` при multipart.** Express `express.json` body-parser НЕ парсит multipart. Form-fields (`display_name`, `description`) парсятся `busboy`'em внутри `acceptSingleFile`. Когда расширяешь handler файла-аплоада — передавай `fields` через `onAccepted`.
- **`grader_path` и `ground_truth_path` НИКОГДА не возвращаются в публичных endpoint'ах.** Тест `sp2_public.test.js` это проверяет — не удаляй проверки при рефакторе.
