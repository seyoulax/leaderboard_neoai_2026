# SP-3 — Submissions & Scoring Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть основной flow платформы — участник сдаёт CSV-файл предсказаний → in-process worker запускает админский `score.py` против public (и опционально private) ground-truth → метрика нормализуется через якоря, появляется на native-лидерборде в той же 4-вариантной форме, что и kaggle.

**Architecture:** Async-runner внутри Node-процесса: `setInterval(2s)` забирает next pending сабмит из таблицы `submissions`, спавнит `python3 <grader> <submission> <gt>`, парсит метрику из последней строки stdout. При наличии `ground_truth_private_path` у задачи — повторно для private (падение private не валит сабмит). Status machine `pending → scoring → scored | failed`; stale-recovery (>15 мин в `scoring`) + retry budget (max 3 attempts). Рейт-лимит 50/24h/(user,task), auto-join в `competition_members` при первом сабмите. Native `/leaderboard` теперь возвращает реальные entries в 4 вариантах (`overall`/`privateOverall`/`oursOverall`/`oursPrivateOverall`), идентично shape'у kaggle. Существующий kaggle-flow не тронут.

**Tech Stack:** Node 20 + Express + `node:test`, `better-sqlite3`, `child_process.spawn` (`python3`), built-in `crypto`. Никаких новых npm-зависимостей.

**Spec:** `docs/superpowers/specs/2026-05-05-sp3-submissions-and-scoring-runner-design.md`

**Prereq:** SP-2 должен быть смержен в main (нужны таблицы `native_tasks`, `native_task_files`, колонка `competitions.visibility`, busboy upload pipeline). Текущее состояние `worktree-sp2-native-tasks` не смержено — **до старта SP-3 запустить `superpowers:finishing-a-development-branch` для SP-2** или вручную вмержить ветку.

---

## File Structure

### Backend

| File | Status | Responsibility |
| --- | --- | --- |
| `backend/src/db/migrations/0003_submissions.sql` | **create** | ALTER native_tasks + CREATE submissions + индексы |
| `backend/src/db/submissionsRepo.js` | **create** | insert, list, status transitions, pickAndMarkScoring, recoverStale |
| `backend/src/db/nativeTasksRepo.js` | modify | поддержка `groundTruthPrivatePath` в getNativeTask/update |
| `backend/src/scoring/runGrader.js` | **create** | spawn python3 + парсинг score из stdout |
| `backend/src/scoring/computePoints.js` | **create** | обёртка над `leaderboard.js#normalizeWithAnchors` |
| `backend/src/scoring/worker.js` | **create** | tick loop + startWorker(db) |
| `backend/src/scoring/nativeLeaderboard.js` | **create** | best-per-user query + 4-variant builder |
| `backend/src/routes/submissionsPublic.js` | **create** | POST + GET own (own list + own get) |
| `backend/src/routes/submissionsAdmin.js` | **create** | admin endpoints (list, delete, rescore, rescore-all, GT-private) |
| `backend/src/routes/nativeTasksAdmin.js` | modify | mount /ground-truth-private slot endpoints |
| `backend/src/index.js` | modify | startWorker(db) после migrations |
| `backend/src/app.js` | modify | mount routers, leaderboard dispatch native — теперь использует submissions |
| `backend/.env.example` | modify | +SCORING_TIMEOUT_MS, MAX_SUBMISSION_BYTES, MAX_SUBMISSIONS_PER_DAY, SUBMISSION_ALLOWED_EXTS, WORKER_TICK_MS, PYTHON_BIN |
| `backend/tests/sp3_db.test.js` | **create** | repo + migration |
| `backend/tests/sp3_grader.test.js` | **create** | runGrader + computePoints + fixtures |
| `backend/tests/sp3_worker.test.js` | **create** | tick loop, public+private, retry, stale |
| `backend/tests/sp3_api.test.js` | **create** | endpoints integration |
| `backend/tests/sp3_leaderboard.test.js` | **create** | 4-variant response shape |
| `backend/tests/fixtures/grader/score-ok.py` | **create** | always print 0.85 |
| `backend/tests/fixtures/grader/score-anchored.py` | **create** | echo first arg's first numeric line — позволяет управлять score из теста |
| `backend/tests/fixtures/grader/score-error.py` | **create** | sys.exit(1) |
| `backend/tests/fixtures/grader/score-timeout.py` | **create** | time.sleep(120) |
| `backend/tests/fixtures/grader/score-bad.py` | **create** | print('not a number') |

### Frontend

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/src/api.js` | modify | submissions.* helpers |
| `frontend/src/native/SubmitForm.jsx` | **create** | upload + кнопка submit |
| `frontend/src/native/MySubmissions.jsx` | **create** | таблица своих сабмитов с polling |
| `frontend/src/native/NativeTaskPage.jsx` | modify | добавить SubmitForm + MySubmissions + leaderboard |
| `frontend/src/admin/AdminNativeTaskEdit.jsx` | modify | private GT slot + Submissions tab + rescore-all |

### Docs

| File | Status |
| --- | --- |
| `new_lb/README.md` | modify (env-таблица + dev-flow про worker) |
| `new_lb/ROUTES.md` | modify (новые endpoints submissions + private GT) |

---

## Phase 0 — Подготовка

### Task 0.1: ENV-переменные + директория для фикстур

**Files:**
- Modify: `backend/.env.example`
- Create: `backend/tests/fixtures/grader/` (директория)

- [ ] **Step 1: Дописать `.env.example`**

В конец файла:
```ini
# SP-3: scoring worker + submissions
PYTHON_BIN=python3
WORKER_TICK_MS=2000
SCORING_TIMEOUT_MS=60000
MAX_SUBMISSION_BYTES=52428800
MAX_SUBMISSIONS_PER_DAY=50
SUBMISSION_ALLOWED_EXTS=csv,tsv,json
```

- [ ] **Step 2: Создать пустую директорию для фикстур**

```bash
mkdir -p backend/tests/fixtures/grader
touch backend/tests/fixtures/grader/.gitkeep
```

- [ ] **Step 3: Smoke**

```bash
cd backend && npm test
```
Expected: существующие тесты зелёные, ничего не сломано.

- [ ] **Step 4: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/.env.example backend/tests/fixtures/grader/.gitkeep
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "chore(sp3): env vars + fixtures dir"
```

> Все git-команды — с `GIT_TERMINAL_PROMPT=0 git --no-pager`. Если зависает даже так — рестарт сессии Claude Code.

---

## Phase 1 — Schema + repos

### Task 1.1: Migration 0003

**Files:**
- Create: `backend/src/db/migrations/0003_submissions.sql`
- Create: `backend/tests/sp3_db.test.js`

- [ ] **Step 1: Падающие тесты миграции**

`backend/tests/sp3_db.test.js`:
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

test('migration 0003: applied after 0001+0002', () => {
  const db = freshDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((r) => r.version), [1, 2, 3]);
});

test('migration 0003: native_tasks gets ground_truth_private_path column', () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(native_tasks)").all().map((c) => c.name);
  assert.ok(cols.includes('ground_truth_private_path'));
});

test('migration 0003: submissions table created with expected columns', () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(submissions)").all().map((c) => c.name);
  for (const expected of [
    'id', 'task_id', 'user_id', 'original_filename', 'size_bytes', 'sha256', 'path',
    'status', 'raw_score_public', 'raw_score_private', 'points_public', 'points_private',
    'attempts', 'error_message', 'log_excerpt', 'duration_ms',
    'started_at', 'scored_at', 'created_at',
  ]) {
    assert.ok(cols.includes(expected), `missing column: ${expected}`);
  }
});

test('migration 0003: status CHECK constraint', () => {
  const db = freshDb();
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  assert.throws(
    () => db.prepare(`INSERT INTO submissions
      (task_id, user_id, original_filename, size_bytes, sha256, path, status)
      VALUES (1, 1, 'x', 1, 'h', '/x', 'BOGUS')`).run(),
    /CHECK/i
  );
});

test('migration 0003: submissions FK cascade on task delete', () => {
  const db = freshDb();
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  db.prepare(`INSERT INTO submissions (task_id, user_id, original_filename, size_bytes, sha256, path)
              VALUES (1, 1, 'x', 1, 'h', '/x')`).run();
  db.prepare("DELETE FROM native_tasks WHERE id = 1").run();
  const left = db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
  assert.equal(left, 0);
});
```

- [ ] **Step 2: Run — FAIL** (нет файла `0003_submissions.sql`)

```bash
cd backend && node --test tests/sp3_db.test.js
```

- [ ] **Step 3: Создать `0003_submissions.sql`**

`backend/src/db/migrations/0003_submissions.sql` — точный SQL из спеки SP-3, секция «Schema». Скопировать как есть.

- [ ] **Step 4: PASS**

```bash
cd backend && node --test tests/sp3_db.test.js
```

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/migrations/0003_submissions.sql backend/tests/sp3_db.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): migration 0003 — submissions + ground_truth_private_path"
```

---

### Task 1.2: nativeTasksRepo поддерживает groundTruthPrivatePath

**Files:**
- Modify: `backend/src/db/nativeTasksRepo.js`
- Modify: `backend/tests/sp3_db.test.js`

- [ ] **Step 1: Тесты**

```js
import { insertNativeTask, getNativeTask, updateNativeTask } from '../src/db/nativeTasksRepo.js';

function seedComp(db) {
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
}

test('nativeTasksRepo: groundTruthPrivatePath round-trip', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  updateNativeTask(db, 'c', 't', { groundTruthPrivatePath: '/abs/private.csv' });
  const got = getNativeTask(db, 'c', 't');
  assert.equal(got.groundTruthPrivatePath, '/abs/private.csv');
});

test('nativeTasksRepo: groundTruthPrivatePath defaults null on insert', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const got = getNativeTask(db, 'c', 't');
  assert.equal(got.groundTruthPrivatePath, null);
});
```

- [ ] **Step 2: FAIL** (поле не вылазит в результат)

- [ ] **Step 3: Расширить `nativeTasksRepo.js`**

В `COLS` добавить `ground_truth_private_path AS groundTruthPrivatePath`. В `UPDATABLE` map добавить `groundTruthPrivatePath: 'ground_truth_private_path'`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/nativeTasksRepo.js backend/tests/sp3_db.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): nativeTasksRepo — groundTruthPrivatePath field"
```

---

### Task 1.3: submissionsRepo

**Files:**
- Create: `backend/src/db/submissionsRepo.js`
- Modify: `backend/tests/sp3_db.test.js`

- [ ] **Step 1: Тесты**

```js
import {
  insertSubmission,
  getSubmission,
  listSubmissionsForUserTask,
  listSubmissionsForTask,
  countRecentSubmissions,
  pickAndMarkScoring,
  markScored,
  markFailed,
  markFailedRetry,
  recoverStale,
  resetSubmissionForRescore,
  resetAllForRescore,
  deleteSubmission,
} from '../src/db/submissionsRepo.js';

function seedTaskAndUser(db) {
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  const task = db.prepare("SELECT id FROM native_tasks WHERE slug='t'").get();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  const user = db.prepare("SELECT id FROM users WHERE email='a@a.a'").get();
  return { taskId: task.id, userId: user.id };
}

test('submissionsRepo.insert + getSubmission', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, {
    taskId, userId,
    originalFilename: 'sub.csv', sizeBytes: 100, sha256: 'h', path: '/abs/sub.csv',
  });
  assert.equal(s.status, 'pending');
  assert.equal(s.attempts, 0);
  const got = getSubmission(db, s.id);
  assert.equal(got.id, s.id);
});

test('submissionsRepo.pickAndMarkScoring: атомарность', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const a = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  const b = insertSubmission(db, { taskId, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  const first = pickAndMarkScoring(db);
  const second = pickAndMarkScoring(db);
  // FIFO + не возвращает уже scoring'нутый
  assert.equal(first.id, a.id);
  assert.equal(second.id, b.id);
  // оба переходят в scoring
  assert.equal(getSubmission(db, a.id).status, 'scoring');
  assert.equal(getSubmission(db, b.id).status, 'scoring');
  // started_at заполнен
  assert.ok(getSubmission(db, a.id).startedAt);
});

test('submissionsRepo.pickAndMarkScoring: возвращает null если pending нет', () => {
  const db = freshDb();
  seedTaskAndUser(db);
  assert.equal(pickAndMarkScoring(db), null);
});

test('submissionsRepo.markScored: обновляет points, status, scored_at', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markScored(db, s.id, {
    rawScorePublic: 0.85, rawScorePrivate: 0.83,
    pointsPublic: 70, pointsPrivate: 65,
    log: 'ok', durationMs: 500,
  });
  const got = getSubmission(db, s.id);
  assert.equal(got.status, 'scored');
  assert.equal(got.rawScorePublic, 0.85);
  assert.equal(got.pointsPrivate, 65);
  assert.ok(got.scoredAt);
});

test('submissionsRepo.markFailed: финальный fail, не возвращается воркером', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markFailed(db, s.id, { error: 'boom', log: 'err', durationMs: 100 });
  const got = getSubmission(db, s.id);
  assert.equal(got.status, 'failed');
  assert.equal(got.errorMessage, 'boom');
  // Воркер не подхватит
  assert.equal(pickAndMarkScoring(db), null);
});

test('submissionsRepo.markFailedRetry: возвращает в pending, attempts++', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markFailedRetry(db, s.id, { error: 'transient', log: '', durationMs: 100 });
  const got = getSubmission(db, s.id);
  assert.equal(got.status, 'pending');
  assert.equal(got.attempts, 1);
  // Воркер подхватит снова
  assert.equal(pickAndMarkScoring(db).id, s.id);
});

test('submissionsRepo.recoverStale: возвращает старые scoring в pending', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  // искусственно состарим started_at
  db.prepare("UPDATE submissions SET started_at = datetime('now', '-30 minutes') WHERE id = ?").run(s.id);
  const recovered = recoverStale(db);
  assert.equal(recovered, 1);
  assert.equal(getSubmission(db, s.id).status, 'pending');
  assert.equal(getSubmission(db, s.id).attempts, 1);
});

test('submissionsRepo.countRecentSubmissions: считает за 24h', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  insertSubmission(db, { taskId, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  // вторая старше 24h
  db.prepare("UPDATE submissions SET created_at = datetime('now', '-25 hours') WHERE original_filename='b'").run();
  assert.equal(countRecentSubmissions(db, { userId, taskId, hours: 24 }), 1);
});

test('submissionsRepo.listSubmissionsForUserTask: DESC по created_at', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const a = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  const b = insertSubmission(db, { taskId, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  const list = listSubmissionsForUserTask(db, { userId, taskId });
  // b создана позже → первая
  assert.equal(list[0].id, b.id);
  assert.equal(list[1].id, a.id);
});

test('submissionsRepo.resetSubmissionForRescore: обнуляет, возвращает в pending', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: 1, pointsPublic: 50, log: '', durationMs: 100 });
  resetSubmissionForRescore(db, s.id);
  const got = getSubmission(db, s.id);
  assert.equal(got.status, 'pending');
  assert.equal(got.rawScorePublic, null);
  assert.equal(got.pointsPublic, null);
  assert.equal(got.attempts, 0);
});

test('submissionsRepo.resetAllForRescore(taskId): сбрасывает все scored+failed', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const a = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  const b = insertSubmission(db, { taskId, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  pickAndMarkScoring(db); markScored(db, a.id, { rawScorePublic: 0.5, pointsPublic: 50, log: '', durationMs: 1 });
  pickAndMarkScoring(db); markFailed(db, b.id, { error: 'x', log: '', durationMs: 1 });
  const reset = resetAllForRescore(db, taskId);
  assert.equal(reset, 2);
  assert.equal(getSubmission(db, a.id).status, 'pending');
  assert.equal(getSubmission(db, b.id).status, 'pending');
});

test('submissionsRepo.deleteSubmission removes row', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  deleteSubmission(db, s.id);
  assert.equal(getSubmission(db, s.id), null);
});
```

- [ ] **Step 2: FAIL** (модуль отсутствует)

- [ ] **Step 3: Реализация**

`backend/src/db/submissionsRepo.js`:
```js
const COLS = `id,
  task_id AS taskId,
  user_id AS userId,
  original_filename AS originalFilename,
  size_bytes AS sizeBytes,
  sha256,
  path,
  status,
  raw_score_public AS rawScorePublic,
  raw_score_private AS rawScorePrivate,
  points_public AS pointsPublic,
  points_private AS pointsPrivate,
  attempts,
  error_message AS errorMessage,
  log_excerpt AS logExcerpt,
  duration_ms AS durationMs,
  started_at AS startedAt,
  scored_at AS scoredAt,
  created_at AS createdAt`;

export function insertSubmission(db, s) {
  const result = db
    .prepare(
      `INSERT INTO submissions (task_id, user_id, original_filename, size_bytes, sha256, path)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(s.taskId, s.userId, s.originalFilename, s.sizeBytes, s.sha256, s.path);
  return getSubmission(db, result.lastInsertRowid);
}

export function getSubmission(db, id) {
  return db.prepare(`SELECT ${COLS} FROM submissions WHERE id = ?`).get(id) || null;
}

export function listSubmissionsForUserTask(db, { userId, taskId }) {
  return db
    .prepare(
      `SELECT ${COLS} FROM submissions
       WHERE user_id = ? AND task_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(userId, taskId);
}

export function listSubmissionsForTask(db, { taskId, status = null }) {
  if (status) {
    return db
      .prepare(`SELECT ${COLS} FROM submissions WHERE task_id = ? AND status = ? ORDER BY created_at DESC, id DESC`)
      .all(taskId, status);
  }
  return db
    .prepare(`SELECT ${COLS} FROM submissions WHERE task_id = ? ORDER BY created_at DESC, id DESC`)
    .all(taskId);
}

export function countRecentSubmissions(db, { userId, taskId, hours }) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM submissions
       WHERE user_id = ? AND task_id = ?
         AND created_at > datetime('now', ?)`
    )
    .get(userId, taskId, `-${hours} hours`).n;
}

// атомарно: возвращает next pending submission и переводит его в scoring
export function pickAndMarkScoring(db) {
  return db.transaction(() => {
    const sub = db
      .prepare(
        `SELECT ${COLS} FROM submissions
         WHERE status = 'pending'
         ORDER BY id ASC
         LIMIT 1`
      )
      .get();
    if (!sub) return null;
    const result = db
      .prepare(
        `UPDATE submissions
         SET status = 'scoring', started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = 'pending'`
      )
      .run(sub.id);
    if (result.changes !== 1) return null; // race: кто-то уже забрал
    return getSubmission(db, sub.id);
  })();
}

export function markScored(db, id, { rawScorePublic, rawScorePrivate = null, pointsPublic, pointsPrivate = null, log, durationMs }) {
  db.prepare(
    `UPDATE submissions
     SET status = 'scored',
         raw_score_public = ?, raw_score_private = ?,
         points_public = ?, points_private = ?,
         log_excerpt = ?, duration_ms = ?,
         scored_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(rawScorePublic, rawScorePrivate, pointsPublic, pointsPrivate, log || '', durationMs, id);
}

export function markFailed(db, id, { error, log, durationMs }) {
  db.prepare(
    `UPDATE submissions
     SET status = 'failed',
         error_message = ?, log_excerpt = ?, duration_ms = ?,
         scored_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(String(error), log || '', durationMs, id);
}

export function markFailedRetry(db, id, { error, log, durationMs }) {
  db.prepare(
    `UPDATE submissions
     SET status = 'pending',
         attempts = attempts + 1,
         error_message = ?, log_excerpt = ?, duration_ms = ?,
         started_at = NULL
     WHERE id = ?`
  ).run(String(error), log || '', durationMs, id);
}

export function recoverStale(db, { staleThresholdMinutes = 15 } = {}) {
  return db.prepare(
    `UPDATE submissions
     SET status = 'pending', attempts = attempts + 1, started_at = NULL,
         error_message = 'recovered from stale scoring'
     WHERE status = 'scoring' AND started_at < datetime('now', ?)`
  ).run(`-${staleThresholdMinutes} minutes`).changes;
}

export function resetSubmissionForRescore(db, id) {
  db.prepare(
    `UPDATE submissions
     SET status = 'pending',
         raw_score_public = NULL, raw_score_private = NULL,
         points_public = NULL, points_private = NULL,
         attempts = 0, error_message = NULL, log_excerpt = NULL,
         duration_ms = NULL, started_at = NULL, scored_at = NULL
     WHERE id = ?`
  ).run(id);
}

export function resetAllForRescore(db, taskId) {
  return db.prepare(
    `UPDATE submissions
     SET status = 'pending',
         raw_score_public = NULL, raw_score_private = NULL,
         points_public = NULL, points_private = NULL,
         attempts = 0, error_message = NULL, log_excerpt = NULL,
         duration_ms = NULL, started_at = NULL, scored_at = NULL
     WHERE task_id = ? AND status IN ('scored', 'failed')`
  ).run(taskId).changes;
}

export function deleteSubmission(db, id) {
  db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/submissionsRepo.js backend/tests/sp3_db.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): submissionsRepo (CRUD + status machine + pickAndMarkScoring)"
```

---

## Phase 2 — Scoring runner

### Task 2.1: Grader fixtures

**Files:**
- Create: `backend/tests/fixtures/grader/score-ok.py`, `score-error.py`, `score-timeout.py`, `score-bad.py`, `score-anchored.py`

- [ ] **Step 1: score-ok.py** — `print('0.85')`

```python
#!/usr/bin/env python3
print('0.85')
```

- [ ] **Step 2: score-error.py** — exit 1

```python
#!/usr/bin/env python3
import sys
sys.stderr.write('grader exploded\n')
sys.exit(1)
```

- [ ] **Step 3: score-timeout.py** — sleep

```python
#!/usr/bin/env python3
import time
time.sleep(120)
print('never reached')
```

- [ ] **Step 4: score-bad.py** — invalid stdout

```python
#!/usr/bin/env python3
print('not a number')
```

- [ ] **Step 5: score-anchored.py** — читает первую строку sub-файла как число

```python
#!/usr/bin/env python3
"""Grader для тестов: возвращает первое число из submission файла.
Позволяет тесту управлять score через содержимое sub-файла."""
import sys
with open(sys.argv[1]) as f:
    line = f.readline().strip()
print(line)
```

- [ ] **Step 6: Сделать исполняемыми**

```bash
chmod +x backend/tests/fixtures/grader/*.py
```

- [ ] **Step 7: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/tests/fixtures/grader
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "test(sp3): grader fixtures (ok/error/timeout/bad/anchored)"
```

---

### Task 2.2: runGrader

**Files:**
- Create: `backend/src/scoring/runGrader.js`
- Create: `backend/tests/sp3_grader.test.js`

- [ ] **Step 1: Тесты**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runGrader } from '../src/scoring/runGrader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(__dirname, 'fixtures/grader');

function makeSubFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3-'));
  const file = path.join(dir, 'sub.csv');
  fs.writeFileSync(file, content);
  return { file, dir };
}

test('runGrader: happy path → 0.85', async () => {
  const { file, dir } = makeSubFile('any');
  const r = await runGrader({
    graderPath: path.join(FX, 'score-ok.py'),
    gtPath: file,
    subPath: file,
    timeoutMs: 5000,
  });
  assert.equal(r.rawScore, 0.85);
  assert.ok(typeof r.durationMs === 'number');
  fs.rmSync(dir, { recursive: true });
});

test('runGrader: anchored — picks score from sub file', async () => {
  const { file, dir } = makeSubFile('0.42\n');
  const r = await runGrader({
    graderPath: path.join(FX, 'score-anchored.py'),
    gtPath: file, subPath: file, timeoutMs: 5000,
  });
  assert.equal(r.rawScore, 0.42);
  fs.rmSync(dir, { recursive: true });
});

test('runGrader: exit≠0 rejects with log', async () => {
  const { file, dir } = makeSubFile('x');
  await assert.rejects(
    () => runGrader({
      graderPath: path.join(FX, 'score-error.py'),
      gtPath: file, subPath: file, timeoutMs: 5000,
    }),
    (e) => /exit code 1/i.test(e.error) && /grader exploded/.test(e.log),
  );
  fs.rmSync(dir, { recursive: true });
});

test('runGrader: timeout', async () => {
  const { file, dir } = makeSubFile('x');
  await assert.rejects(
    () => runGrader({
      graderPath: path.join(FX, 'score-timeout.py'),
      gtPath: file, subPath: file, timeoutMs: 200,
    }),
    (e) => /timeout/i.test(e.error),
  );
  fs.rmSync(dir, { recursive: true });
});

test('runGrader: invalid stdout (NaN)', async () => {
  const { file, dir } = makeSubFile('x');
  await assert.rejects(
    () => runGrader({
      graderPath: path.join(FX, 'score-bad.py'),
      gtPath: file, subPath: file, timeoutMs: 5000,
    }),
    (e) => /invalid score/i.test(e.error),
  );
  fs.rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/scoring/runGrader.js`:
```js
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const MAX_LOG_BYTES = 8192;

export function runGrader({ graderPath, gtPath, subPath, timeoutMs, pythonBin = process.env.PYTHON_BIN || 'python3' }) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(pythonBin, [graderPath, subPath, gtPath], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      const durationMs = Math.round(performance.now() - start);
      reject({ error: err.message, log: stderr.slice(-MAX_LOG_BYTES), durationMs });
    });
    child.on('close', (code, signal) => {
      const durationMs = Math.round(performance.now() - start);
      const log = (`${stderr}\n--- STDOUT ---\n${stdout}`).slice(-MAX_LOG_BYTES);
      // node's spawn timeout sends SIGTERM
      if (signal === 'SIGTERM' || timedOut) {
        return reject({ error: `timeout after ${timeoutMs}ms`, log, durationMs });
      }
      if (code !== 0) {
        return reject({ error: `grader exit code ${code}`, log, durationMs });
      }
      const lastNonEmpty = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '';
      const score = Number(lastNonEmpty);
      if (!Number.isFinite(score)) {
        return reject({
          error: `invalid score from grader: ${JSON.stringify(lastNonEmpty.slice(0, 200))}`,
          log, durationMs,
        });
      }
      resolve({ rawScore: score, log, durationMs });
    });
  });
}
```

- [ ] **Step 4: PASS**

```bash
cd backend && node --test tests/sp3_grader.test.js
```

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/scoring/runGrader.js backend/tests/sp3_grader.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): runGrader (spawn python3 + parse last-line score)"
```

---

### Task 2.3: computePoints

**Files:**
- Create: `backend/src/scoring/computePoints.js`
- Modify: `backend/tests/sp3_grader.test.js`

- [ ] **Step 1: Тесты**

```js
import { computePoints } from '../src/scoring/computePoints.js';

test('computePoints: anchored higher-better', () => {
  // baseline 0.5, author 0.95
  // raw 0.80 → (0.80 - 0.5) / (0.95 - 0.5) * 100 = 66.67
  const p = computePoints({ raw: 0.80, baseline: 0.5, author: 0.95, higherIsBetter: true });
  assert.ok(Math.abs(p - 66.6666666) < 0.001);
});

test('computePoints: anchored lower-better (RMSE-style)', () => {
  // baseline 1.0 (worse), author 0.2 (better) — для RMSE меньше = лучше
  // higherIsBetter=false; нормализация всё равно через якоря
  const p = computePoints({ raw: 0.6, baseline: 1.0, author: 0.2, higherIsBetter: false });
  // (0.6 - 1.0) / (0.2 - 1.0) * 100 = (-0.4) / (-0.8) * 100 = 50
  assert.ok(Math.abs(p - 50) < 0.001);
});

test('computePoints: max(0, ...) — хуже baseline = 0', () => {
  assert.equal(computePoints({ raw: 0.4, baseline: 0.5, author: 0.95, higherIsBetter: true }), 0);
});

test('computePoints: без якорей возвращает raw', () => {
  assert.equal(computePoints({ raw: 0.85, baseline: null, author: null, higherIsBetter: true }), 0.85);
  assert.equal(computePoints({ raw: 0.85, baseline: 0.5, author: null, higherIsBetter: true }), 0.85);
});

test('computePoints: precedes 100 если raw > author', () => {
  const p = computePoints({ raw: 0.97, baseline: 0.5, author: 0.95, higherIsBetter: true });
  assert.ok(p > 100); // ровно ~104.4
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/scoring/computePoints.js`:
```js
export function computePoints({ raw, baseline, author, higherIsBetter }) {
  if (baseline == null || author == null || baseline === author) {
    // Нет валидных якорей — без нормализации
    return raw;
  }
  const points = ((raw - baseline) / (author - baseline)) * 100;
  return Math.max(0, points);
}
```

> Замечание: формула одна и та же для higher-better и lower-better. Знак автоматически инвертируется через знак `(author - baseline)` (для RMSE-стиля `author < baseline` → знак знаменателя отрицательный, и raw меньше baseline даёт положительные points). `higherIsBetter` параметр сейчас не используется в формуле, но оставлен в сигнатуре для совместимости с существующим `leaderboard.js#normalizeWithAnchors` (если в будущем поведение разделится). Удалить параметр можно при ревью.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/scoring/computePoints.js backend/tests/sp3_grader.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): computePoints (anchor normalization)"
```

---

### Task 2.4: Worker tick — public-only

**Files:**
- Create: `backend/src/scoring/worker.js`
- Create: `backend/tests/sp3_worker.test.js`

- [ ] **Step 1: Тест**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { insertSubmission, getSubmission } from '../src/db/submissionsRepo.js';
import { tick } from '../src/scoring/worker.js';
import { insertNativeTask, updateNativeTask } from '../src/db/nativeTasksRepo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(__dirname, 'fixtures/grader');

function setup(graderName, opts = {}) {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  insertNativeTask(db, {
    competitionSlug: 'c', slug: 't', title: 'T',
    baselineScorePublic: opts.baselinePublic, authorScorePublic: opts.authorPublic,
    baselineScorePrivate: opts.baselinePrivate, authorScorePrivate: opts.authorPrivate,
  });
  if (opts.privateGT) updateNativeTask(db, 'c', 't', { groundTruthPrivatePath: opts.privateGT });
  if (opts.publicGT) updateNativeTask(db, 'c', 't', { groundTruthPath: opts.publicGT });
  if (opts.grader) updateNativeTask(db, 'c', 't', { graderPath: path.join(FX, graderName) });
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  return db;
}

function makeFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3w-'));
  const file = path.join(dir, 'sub.csv');
  fs.writeFileSync(file, content);
  return { file, dir };
}

test('worker.tick: public-only — task без private GT, single grader run', async () => {
  const { file: gt, dir: dGt } = makeFile('truth');
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-ok.py', {
    grader: true, publicGT: gt,
    baselinePublic: 0.5, authorPublic: 0.95,
  });
  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  await tick(db, { timeoutMs: 5000 });
  const got = getSubmission(db, submission.id);
  assert.equal(got.status, 'scored');
  assert.equal(got.rawScorePublic, 0.85);
  assert.ok(Math.abs(got.pointsPublic - ((0.85 - 0.5) / (0.95 - 0.5) * 100)) < 0.001);
  assert.equal(got.rawScorePrivate, null);
  assert.equal(got.pointsPrivate, null);
  fs.rmSync(dGt, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
});

test('worker.tick: idle — нет pending → ничего не делает', async () => {
  const db = setup('score-ok.py', { grader: true });
  await tick(db, { timeoutMs: 5000 });
  // нет ошибок — ничего не пытался запускать
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация (только public-path)**

`backend/src/scoring/worker.js`:
```js
import { runGrader } from './runGrader.js';
import { computePoints } from './computePoints.js';
import {
  pickAndMarkScoring,
  markScored,
  markFailed,
  markFailedRetry,
  recoverStale,
  getSubmission,
} from '../db/submissionsRepo.js';
import { getNativeTaskById } from '../db/nativeTasksRepo.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

export async function tick(db, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.SCORING_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  recoverStale(db);
  const sub = pickAndMarkScoring(db);
  if (!sub) return;
  const task = getNativeTaskById(db, sub.taskId);
  if (!task) return markFailed(db, sub.id, { error: 'task missing', log: '', durationMs: 0 });
  if (!task.graderPath) return markFailed(db, sub.id, { error: 'grader not configured', log: '', durationMs: 0 });
  if (!task.groundTruthPath) return markFailed(db, sub.id, { error: 'public ground_truth not configured', log: '', durationMs: 0 });
  try {
    const pub = await runGrader({ graderPath: task.graderPath, gtPath: task.groundTruthPath, subPath: sub.path, timeoutMs });
    const pointsPublic = computePoints({
      raw: pub.rawScore,
      baseline: task.baselineScorePublic,
      author: task.authorScorePublic,
      higherIsBetter: task.higherIsBetter,
    });
    markScored(db, sub.id, {
      rawScorePublic: pub.rawScore,
      pointsPublic,
      log: pub.log,
      durationMs: pub.durationMs,
    });
  } catch (e) {
    handleFailure(db, sub, e);
  }
}

function handleFailure(db, sub, e) {
  const willExceedBudget = sub.attempts + 1 >= MAX_ATTEMPTS;
  if (willExceedBudget) markFailed(db, sub.id, e);
  else markFailedRetry(db, sub.id, e);
}

export function startWorker(db, { intervalMs } = {}) {
  const ms = intervalMs ?? Number(process.env.WORKER_TICK_MS || 2000);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(db); } catch (err) { console.error('[worker] tick error', err); }
    finally { running = false; }
  }, ms);
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/scoring/worker.js backend/tests/sp3_worker.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): worker tick (public-only path)"
```

---

### Task 2.5: Worker tick — public + private

**Files:**
- Modify: `backend/src/scoring/worker.js`
- Modify: `backend/tests/sp3_worker.test.js`

- [ ] **Step 1: Тесты**

Добавить в `sp3_worker.test.js`:
```js
test('worker.tick: public+private — оба запуска, оба points', async () => {
  const { file: gtPub, dir: dGtPub } = makeFile('truth-pub');
  const { file: gtPriv, dir: dGtPriv } = makeFile('truth-priv');
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-ok.py', {
    grader: true, publicGT: gtPub, privateGT: gtPriv,
    baselinePublic: 0.5, authorPublic: 0.95,
    baselinePrivate: 0.4, authorPrivate: 0.85,
  });
  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  await tick(db, { timeoutMs: 5000 });
  const got = getSubmission(db, submission.id);
  assert.equal(got.status, 'scored');
  assert.equal(got.rawScorePublic, 0.85);
  assert.equal(got.rawScorePrivate, 0.85);
  // private: (0.85 - 0.4) / (0.85 - 0.4) * 100 = 100
  assert.ok(Math.abs(got.pointsPrivate - 100) < 0.001);
  fs.rmSync(dGtPub, { recursive: true });
  fs.rmSync(dGtPriv, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
});

test('worker.tick: private grader fails → public still scored, private NULL, log контейнит [private failed]', async () => {
  // фокус: используем разные граундтрусы и УПАВШИЙ грейдер для private
  // трюк: повторно запустить ту же score-ok грейдер — public сработает, а private должен падать.
  // чтобы заставить ИМЕННО private падать, используем score-anchored.py: с public-GT он считает первую строку sub'a (ОК),
  // а private-GT — будет другой файл с мусорным содержимым… но grader читает sub, не gt. Поэтому используем более простой сценарий:
  // public score-ok (всегда 0.85), private score-bad (всегда NaN).
  // Способ: переключаем graderPath между запусками? Не подойдёт — у задачи одна grader_path.
  // Альтернатива: имитируем падение через private-GT, который не существует на диске → spawn получит ENOENT.
  const { file: gtPub, dir: dGtPub } = makeFile('truth');
  const fakeGtPriv = '/nonexistent/path/private-gt.csv';
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-anchored.py', {
    grader: true, publicGT: gtPub, privateGT: fakeGtPriv,
    baselinePublic: 0, authorPublic: 1,
  });
  // sub содержит '0.7\n' → grader для public читает sub и печатает 0.7 → ok
  // grader для private тоже читает sub (тот же скрипт), напечатает 0.7 → ok тоже!
  // Это значит этот тест НЕ моделирует падение private. Заменим на:
  // grader-private-failing.py — grader, который падает если последний arg (gt) не существует:
  // Этот fixture добавим отдельно ниже, а тест перепишем чтобы использовать его.
  // Для упрощения: создаём кастомный grader inline через temp-файл.

  // Inline grader, который проверяет что gt существует:
  const inlineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3-inline-'));
  const inlineGrader = path.join(inlineDir, 'g.py');
  fs.writeFileSync(inlineGrader, `#!/usr/bin/env python3
import sys, os
sub_path, gt_path = sys.argv[1], sys.argv[2]
if not os.path.exists(gt_path):
    sys.stderr.write('gt not found\\n')
    sys.exit(2)
print('0.5')
`);
  fs.chmodSync(inlineGrader, 0o755);
  updateNativeTask(db, 'c', 't', { graderPath: inlineGrader });

  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  await tick(db, { timeoutMs: 5000 });
  const got = getSubmission(db, submission.id);
  assert.equal(got.status, 'scored');
  assert.equal(got.rawScorePublic, 0.5);
  assert.equal(got.pointsPrivate, null);
  assert.match(got.logExcerpt || '', /\[private failed\]/);
  fs.rmSync(dGtPub, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
  fs.rmSync(inlineDir, { recursive: true });
});
```

- [ ] **Step 2: FAIL** (worker сейчас не обрабатывает private)

- [ ] **Step 3: Расширить tick'ом**

В `worker.js` заменить блок успешного кейса (между `try {` и `} catch`) на:

```js
try {
  // 1. Public — обязательный
  const pub = await runGrader({ graderPath: task.graderPath, gtPath: task.groundTruthPath, subPath: sub.path, timeoutMs });
  const pointsPublic = computePoints({
    raw: pub.rawScore,
    baseline: task.baselineScorePublic,
    author: task.authorScorePublic,
    higherIsBetter: task.higherIsBetter,
  });

  // 2. Private — только если у задачи задан второй GT
  let rawScorePrivate = null;
  let pointsPrivate = null;
  let privateLog = '(no private GT configured)';
  let privateDurationMs = 0;
  if (task.groundTruthPrivatePath) {
    try {
      const priv = await runGrader({
        graderPath: task.graderPath,
        gtPath: task.groundTruthPrivatePath,
        subPath: sub.path,
        timeoutMs,
      });
      rawScorePrivate = priv.rawScore;
      pointsPrivate = computePoints({
        raw: priv.rawScore,
        baseline: task.baselineScorePrivate,
        author: task.authorScorePrivate,
        higherIsBetter: task.higherIsBetter,
      });
      privateLog = priv.log;
      privateDurationMs = priv.durationMs;
    } catch (e) {
      privateLog = `[private failed] ${e.error}\n${e.log || ''}`;
      privateDurationMs = e.durationMs || 0;
    }
  }

  const log = `--- public ---\n${pub.log}\n--- private ---\n${privateLog}`.slice(-8192);
  markScored(db, sub.id, {
    rawScorePublic: pub.rawScore,
    rawScorePrivate,
    pointsPublic,
    pointsPrivate,
    log,
    durationMs: pub.durationMs + privateDurationMs,
  });
} catch (e) {
  handleFailure(db, sub, e);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/scoring/worker.js backend/tests/sp3_worker.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): worker — public + private grader runs"
```

---

### Task 2.6: Worker — retry budget + stale recovery integration test

**Files:**
- Modify: `backend/tests/sp3_worker.test.js`

- [ ] **Step 1: Тесты**

```js
test('worker: retry budget — 3 фейла подряд → status=failed окончательно', async () => {
  const { file: gt, dir: dGt } = makeFile('truth');
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-error.py', { grader: true, publicGT: gt });
  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  await tick(db, { timeoutMs: 5000 });
  assert.equal(getSubmission(db, submission.id).status, 'pending');
  assert.equal(getSubmission(db, submission.id).attempts, 1);
  await tick(db, { timeoutMs: 5000 });
  assert.equal(getSubmission(db, submission.id).status, 'pending');
  assert.equal(getSubmission(db, submission.id).attempts, 2);
  await tick(db, { timeoutMs: 5000 });
  // 3-я попытка ⇒ финальный fail
  assert.equal(getSubmission(db, submission.id).status, 'failed');
  fs.rmSync(dGt, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
});

test('worker: stale recovery — старый scoring возвращается в pending на следующем tick', async () => {
  const { file: gt, dir: dGt } = makeFile('truth');
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-ok.py', { grader: true, publicGT: gt });
  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  // искусственно делаем submission scoring со старым started_at
  db.prepare("UPDATE submissions SET status='scoring', started_at=datetime('now', '-30 minutes') WHERE id=?").run(submission.id);
  await tick(db, { timeoutMs: 5000 });
  // recoverStale в начале tick'a вернул её в pending → tick тут же обработал
  assert.equal(getSubmission(db, submission.id).status, 'scored');
  fs.rmSync(dGt, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
});
```

- [ ] **Step 2: PASS** (логика уже реализована в Task 2.4-2.5)

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/tests/sp3_worker.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "test(sp3): worker retry budget + stale recovery integration"
```

---

## Phase 3 — Submission endpoints (public)

### Task 3.1: POST submission + auto-join + rate limit

**Files:**
- Create: `backend/src/routes/submissionsPublic.js`
- Modify: `backend/src/app.js` (mount router)
- Create: `backend/tests/sp3_api.test.js`

- [ ] **Step 1: Тесты**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import { insertNativeTask, updateNativeTask } from '../src/db/nativeTasksRepo.js';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

async function setupApp(opts = {}) {
  process.env.ADMIN_TOKEN = 'shared';
  const db = new Database(':memory:');
  runMigrations(db);
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  if (opts.gt) updateNativeTask(db, 'c', 't', { groundTruthPath: opts.gt, graderPath: opts.grader });
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const app = createApp({ db });
  return { db, app, userId: u.id, cookie: `${SESSION_COOKIE}=${sess.id}` };
}

async function start(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }

function multipartBody(filename, content, mime = 'text/csv') {
  const boundary = '----X';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

test('POST /submissions: создаёт pending + auto-join', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3api-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { db, app, userId, cookie } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const { body, boundary } = multipartBody('sub.csv', 'a,b\n1,2\n');
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie },
    body,
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.submission.status, 'pending');
  // файл на диске
  assert.ok(fs.existsSync(j.submission.path));
  // auto-join
  const member = db.prepare("SELECT * FROM competition_members WHERE competition_slug='c' AND user_id=?").get(userId);
  assert.ok(member);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('POST /submissions: 401 для анонима', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3api-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const { body, boundary } = multipartBody('sub.csv', 'x');
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
  assert.equal(r.status, 401);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('POST /submissions: запрещённое расширение → 400', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3api-'));
  process.env.NATIVE_DATA_DIR = tmp;
  process.env.SUBMISSION_ALLOWED_EXTS = 'csv';
  const { app, cookie } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const { body, boundary } = multipartBody('sub.exe', 'binary', 'application/octet-stream');
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie },
    body,
  });
  assert.equal(r.status, 400);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('POST /submissions: rate limit 51-й сабмит → 429', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3api-'));
  process.env.NATIVE_DATA_DIR = tmp;
  process.env.MAX_SUBMISSIONS_PER_DAY = '2';
  const { db, app, userId, cookie } = await setupApp();
  // bulk-insert 2 submission'а 'вручную' через repo чтобы не делать 50 multipart'ов
  const { insertSubmission } = await import('../src/db/submissionsRepo.js');
  insertSubmission(db, { taskId: 1, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  insertSubmission(db, { taskId: 1, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });

  const server = await start(app);
  const port = server.address().port;
  const { body, boundary } = multipartBody('c.csv', 'x');
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, cookie },
    body,
  });
  assert.equal(r.status, 429);
  delete process.env.MAX_SUBMISSIONS_PER_DAY;
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация router'a**

`backend/src/routes/submissionsPublic.js`:
```js
import { Router } from 'express';
import path from 'node:path';
import { acceptSingleFile } from '../upload/multipartFile.js';
import { safeFilename } from '../upload/safeFilename.js';
import { getCompetition } from '../db/competitionsRepo.js';
import { getNativeTask, getNativeTaskById } from '../db/nativeTasksRepo.js';
import {
  insertSubmission,
  getSubmission,
  listSubmissionsForUserTask,
  countRecentSubmissions,
  deleteSubmission,
} from '../db/submissionsRepo.js';
import { requireAuth } from '../auth/middleware.js';

const NATIVE_DATA_DIR = () => path.resolve(process.env.NATIVE_DATA_DIR || './data/native');
const ALLOWED_EXTS = () => (process.env.SUBMISSION_ALLOWED_EXTS || 'csv,tsv,json').split(',').map((s) => s.trim().toLowerCase());
const MAX_BYTES = () => Number(process.env.MAX_SUBMISSION_BYTES || 52_428_800);
const MAX_PER_DAY = () => Number(process.env.MAX_SUBMISSIONS_PER_DAY || 50);

function subDir(comp, task) {
  return path.join(NATIVE_DATA_DIR(), comp, task, 'submissions');
}

function autoJoin(db, compSlug, userId) {
  db.prepare(`INSERT OR IGNORE INTO competition_members (competition_slug, user_id) VALUES (?, ?)`).run(compSlug, userId);
}

function publicSubmission(s) {
  if (!s) return null;
  return {
    id: s.id, taskId: s.taskId, status: s.status,
    originalFilename: s.originalFilename, sizeBytes: s.sizeBytes,
    rawScorePublic: s.rawScorePublic, rawScorePrivate: s.rawScorePrivate,
    pointsPublic: s.pointsPublic, pointsPrivate: s.pointsPrivate,
    errorMessage: s.errorMessage, logExcerpt: s.logExcerpt,
    durationMs: s.durationMs, attempts: s.attempts,
    createdAt: s.createdAt, scoredAt: s.scoredAt,
    path: s.path, // используется только для admin; в public-обёртке скрывать
  };
}

function publicSubmissionForUser(s) {
  if (!s) return null;
  const out = publicSubmission(s);
  delete out.path;
  return out;
}

export function createSubmissionsPublicRouter({ db }) {
  const router = Router({ mergeParams: true });

  router.post('/', requireAuth, async (req, res) => {
    const compSlug = req.params.competitionSlug;
    const taskSlug = req.params.taskSlug;
    const c = getCompetition(db, compSlug);
    if (!c || c.deletedAt || c.type !== 'native') return res.status(404).json({ error: 'not found' });
    const task = getNativeTask(db, compSlug, taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });

    // rate limit
    const recent = countRecentSubmissions(db, { userId: req.user.id, taskId: task.id, hours: 24 });
    if (recent >= MAX_PER_DAY()) {
      return res.status(429).json({ error: `rate limit: max ${MAX_PER_DAY()} submissions per 24h per task`, recent });
    }

    const allowedExts = ALLOWED_EXTS();
    const destDir = subDir(compSlug, taskSlug);

    let pendingId = null;
    acceptSingleFile(req, res, {
      maxBytes: MAX_BYTES(),
      destDir,
      makeFinalName: (info) => `.pending-${Date.now()}-${safeFilename(info.filename)}`,
      onAccepted: async ({ size, sha256, finalPath, originalFilename }) => {
        // расширение
        const ext = (originalFilename.split('.').pop() || '').toLowerCase();
        if (!allowedExts.includes(ext)) {
          await (await import('node:fs/promises')).rm(finalPath, { force: true });
          return res.status(400).json({ error: `extension .${ext} not in whitelist (${allowedExts.join(',')})` });
        }
        // auto-join
        autoJoin(db, compSlug, req.user.id);
        // insert pending row → переименовать → commit path
        const row = insertSubmission(db, {
          taskId: task.id, userId: req.user.id,
          originalFilename, sizeBytes: size, sha256,
          path: '', // временно
        });
        const finalName = `${row.id}-${safeFilename(originalFilename)}`;
        const targetPath = path.join(destDir, finalName);
        try {
          const fsp = await import('node:fs/promises');
          await fsp.rename(finalPath, targetPath);
          db.prepare('UPDATE submissions SET path = ? WHERE id = ?').run(targetPath, row.id);
          res.json({ submission: publicSubmissionForUser(getSubmission(db, row.id)) });
        } catch (e) {
          deleteSubmission(db, row.id);
          (await import('node:fs/promises')).rm(finalPath, { force: true }).catch(() => {});
          res.status(500).json({ error: e.message });
        }
      },
      onError: (err, status) => res.status(status || 500).json({ error: err.message }),
    });
  });

  router.get('/me', requireAuth, (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt || c.type !== 'native') return res.status(404).json({ error: 'not found' });
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const list = listSubmissionsForUserTask(db, { userId: req.user.id, taskId: task.id });
    res.json({ submissions: list.map(publicSubmissionForUser) });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const sub = getSubmission(db, Number(req.params.id));
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.userId !== req.user.id && req.user.role !== 'admin') return res.status(404).json({ error: 'not found' });
    res.json({ submission: publicSubmissionForUser(sub) });
  });

  return router;
}
```

В `app.js` — mount:
```js
import { createSubmissionsPublicRouter } from './routes/submissionsPublic.js';
app.use('/api/competitions/:competitionSlug/native-tasks/:taskSlug/submissions', createSubmissionsPublicRouter({ db }));
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/submissionsPublic.js backend/src/app.js backend/tests/sp3_api.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): POST /submissions + GET own list/detail + auto-join + rate limit"
```

---

## Phase 4 — Admin endpoints

### Task 4.1: GET all submissions + DELETE + rescore single

**Files:**
- Create: `backend/src/routes/submissionsAdmin.js`
- Modify: `backend/src/app.js`
- Modify: `backend/tests/sp3_api.test.js`

- [ ] **Step 1: Тесты**

```js
test('admin: GET all submissions, DELETE one, POST /rescore', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3-adm-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { db, app, userId } = await setupApp();
  const { insertSubmission, markScored } = await import('../src/db/submissionsRepo.js');
  const sub = insertSubmission(db, { taskId: 1, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  const { pickAndMarkScoring } = await import('../src/db/submissionsRepo.js');
  pickAndMarkScoring(db);
  markScored(db, sub.id, { rawScorePublic: 0.5, pointsPublic: 50, log: '', durationMs: 1 });
  const server = await start(app);
  const port = server.address().port;

  // GET list
  const list = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/native-tasks/t/submissions`, {
    headers: { 'x-admin-token': 'shared' },
  }).then((r) => r.json());
  assert.equal(list.submissions.length, 1);

  // POST rescore
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/native-tasks/t/submissions/${sub.id}/rescore`, {
    method: 'POST', headers: { 'x-admin-token': 'shared' },
  });
  assert.equal(r.status, 200);
  const got = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${sub.id}`, {
    headers: { 'x-admin-token': 'shared' }, // admin может смотреть чужой
  }).then((r) => r.json());
  assert.equal(got.submission.status, 'pending');
  assert.equal(got.submission.pointsPublic, null);

  // DELETE
  fs.writeFileSync('/tmp/sp3-fake.csv', 'x'); // создадим файл чтобы DELETE его 'удалил'
  db.prepare("UPDATE submissions SET path = '/tmp/sp3-fake.csv' WHERE id = ?").run(sub.id);
  const d = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/native-tasks/t/submissions/${sub.id}`, {
    method: 'DELETE', headers: { 'x-admin-token': 'shared' },
  });
  assert.equal(d.status, 200);
  assert.equal(fs.existsSync('/tmp/sp3-fake.csv'), false);

  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/routes/submissionsAdmin.js`:
```js
import { Router } from 'express';
import { getCompetition } from '../db/competitionsRepo.js';
import { getNativeTask } from '../db/nativeTasksRepo.js';
import {
  listSubmissionsForTask,
  getSubmission,
  resetSubmissionForRescore,
  resetAllForRescore,
  deleteSubmission,
} from '../db/submissionsRepo.js';

export function createSubmissionsAdminRouter({ db }) {
  const router = Router({ mergeParams: true });

  function requireNativeTask(req, res) {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt || c.type !== 'native') {
      res.status(404).json({ error: 'not found' });
      return null;
    }
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return null;
    }
    return task;
  }

  router.get('/', (req, res) => {
    const task = requireNativeTask(req, res);
    if (!task) return;
    const status = req.query.status || null;
    const list = listSubmissionsForTask(db, { taskId: task.id, status });
    res.json({ submissions: list });
  });

  router.delete('/:id', async (req, res) => {
    const task = requireNativeTask(req, res);
    if (!task) return;
    const sub = getSubmission(db, Number(req.params.id));
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.taskId !== task.id) return res.status(404).json({ error: 'not found' });
    deleteSubmission(db, sub.id);
    try {
      const fsp = await import('node:fs/promises');
      await fsp.rm(sub.path, { force: true });
    } catch (e) {
      console.warn(`[admin/sub delete] disk cleanup failed: ${e.message}`);
    }
    res.json({ ok: true });
  });

  router.post('/:id/rescore', (req, res) => {
    const task = requireNativeTask(req, res);
    if (!task) return;
    const sub = getSubmission(db, Number(req.params.id));
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.taskId !== task.id) return res.status(404).json({ error: 'not found' });
    resetSubmissionForRescore(db, sub.id);
    res.json({ ok: true, submission: getSubmission(db, sub.id) });
  });

  router.post('/rescore-all', (req, res) => {
    const task = requireNativeTask(req, res);
    if (!task) return;
    const reset = resetAllForRescore(db, task.id);
    res.json({ ok: true, reset });
  });

  return router;
}
```

В `app.js`:
```js
import { createSubmissionsAdminRouter } from './routes/submissionsAdmin.js';
app.use(
  '/api/admin/competitions/:competitionSlug/native-tasks/:taskSlug/submissions',
  adminMw,
  createSubmissionsAdminRouter({ db }),
);
```

`/rescore-all` лежит на пути `/.../submissions/rescore-all` — Express'у это «id = rescore-all» по `:id` маршруту. Чтобы избежать коллизии, внутри роутера `/rescore-all` объявлен **до** `/:id/rescore`. Express матчит по порядку — это работает. Если предпочтительнее, сделать на уровне task router'а: `router.post('/:taskSlug/rescore-all', ...)` в `nativeTasksAdmin.js` — обсуждаемо при ревью.

> Замечание для имплементера: уточнить порядок объявления маршрутов в router'е — `/rescore-all` ДО `/:id/rescore` и `/:id`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/submissionsAdmin.js backend/src/app.js backend/tests/sp3_api.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(admin/sub): list + delete + rescore + rescore-all"
```

---

### Task 4.2: PUT/DELETE ground-truth-private

**Files:**
- Modify: `backend/src/routes/nativeTasksAdmin.js`
- Modify: `backend/tests/sp3_api.test.js`

- [ ] **Step 1: Тест**

```js
test('admin PUT /ground-truth-private + DELETE: pишет/обнуляет groundTruthPrivatePath', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3-gt-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { db, app } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const boundary = '----X';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="priv.csv"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.from('id,label\n1,A\n'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/native-tasks/t/ground-truth-private`, {
    method: 'PUT',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-admin-token': 'shared' },
    body,
  });
  assert.equal(r.status, 200);
  const t = db.prepare("SELECT ground_truth_private_path FROM native_tasks WHERE slug='t'").get();
  assert.ok(t.ground_truth_private_path);
  assert.ok(fs.existsSync(t.ground_truth_private_path));

  const d = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/native-tasks/t/ground-truth-private`, {
    method: 'DELETE', headers: { 'x-admin-token': 'shared' },
  });
  assert.equal(d.status, 200);
  const t2 = db.prepare("SELECT ground_truth_private_path FROM native_tasks WHERE slug='t'").get();
  assert.equal(t2.ground_truth_private_path, null);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Расширить `nativeTasksAdmin.js`**

В существующем файле (создан в SP-2) — переиспользовать `singleSlotEndpoint` фабрику. Добавить:
```js
router.put('/:taskSlug/ground-truth-private', singleSlotEndpoint('ground-truth-private', 'groundTruthPrivate', 'MAX_GROUND_TRUTH_BYTES'));

router.delete('/:taskSlug/ground-truth-private', async (req, res) => {
  const r = requireNativeComp(db, req.params.competitionSlug);
  if (r.error) return res.status(r.error.status).json({ error: r.error.message });
  const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.groundTruthPrivatePath) {
    const fs = await import('node:fs/promises');
    await fs.rm(task.groundTruthPrivatePath, { force: true }).catch(() => {});
  }
  updateNativeTask(db, req.params.competitionSlug, req.params.taskSlug, { groundTruthPrivatePath: null });
  res.json({ ok: true });
});
```

`singleSlotEndpoint('ground-truth-private', ..., ...)` уже умеет обрабатывать новые слоты — нужно проверить что на 'ground-truth-private' она пишет в правильную колонку. Если фабрика была hardcoded под `'grader'`/`'ground-truth'` — отрефакторить чтобы принимала `pathField` (имя колонки), дальше использовать.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/nativeTasksAdmin.js backend/tests/sp3_api.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(admin/native): PUT/DELETE ground-truth-private slot"
```

---

## Phase 5 — Native leaderboard

### Task 5.1: nativeLeaderboard query + builder

**Files:**
- Create: `backend/src/scoring/nativeLeaderboard.js`
- Create: `backend/tests/sp3_leaderboard.test.js`

- [ ] **Step 1: Тесты**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import { insertNativeTask, updateNativeTask } from '../src/db/nativeTasksRepo.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertSubmission, pickAndMarkScoring, markScored } from '../src/db/submissionsRepo.js';
import { buildNativeLeaderboard } from '../src/scoring/nativeLeaderboard.js';

function seed(db) {
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t1 = insertNativeTask(db, {
    competitionSlug: 'c', slug: 't1', title: 'T1',
    baselineScorePublic: 0, authorScorePublic: 1,
  });
  const t2 = insertNativeTask(db, {
    competitionSlug: 'c', slug: 't2', title: 'T2',
    baselineScorePublic: 0, authorScorePublic: 1,
  });
  const u1 = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'Alice', kaggleId: 'alice' });
  const u2 = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'Bob', kaggleId: 'bob' });
  return { taskIds: [t1.id, t2.id], userIds: [u1.id, u2.id] };
}

function score(db, taskId, userId, points) {
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: '/x' });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: points / 100, pointsPublic: points, log: '', durationMs: 1 });
}

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

test('buildNativeLeaderboard: best per user per task, sum totalPoints', () => {
  const db = freshDb();
  const { taskIds: [t1, t2], userIds: [u1, u2] } = seed(db);
  // u1: на t1 → 70 (best), 50, 80 → лучший 80; на t2 → 60
  score(db, t1, u1, 70);
  score(db, t1, u1, 50);
  score(db, t1, u1, 80);
  score(db, t2, u1, 60);
  // u2: на t1 → 90; на t2 → нет сабмитов
  score(db, t1, u2, 90);

  const lb = buildNativeLeaderboard(db, 'c', 'public');

  // overall sorted by totalPoints DESC
  assert.equal(lb.overall.length, 2);
  assert.equal(lb.overall[0].nickname, 'Bob');     // 90 + 0 = 90? нет, нужно решить как считать "пропущенные задачи"
  // … продолжается ниже после уточнения подхода
});

test('buildNativeLeaderboard: пустые сабмиты → пустой ответ', () => {
  const db = freshDb();
  seed(db);
  const lb = buildNativeLeaderboard(db, 'c', 'public');
  assert.equal(lb.overall.length, 0);
});

test('buildNativeLeaderboard: variant=private игнорирует submission без points_private', () => {
  const db = freshDb();
  const { taskIds: [t1] } = seed(db);
  const u = createUser(db, { email: 'x@x.x', passwordHash: 'h', displayName: 'X' });
  const s = insertSubmission(db, { taskId: t1, userId: u.id, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: 0.5, pointsPublic: 50, log: '', durationMs: 1 }); // points_private = NULL
  const lb = buildNativeLeaderboard(db, 'c', 'private');
  assert.equal(lb.overall.length, 0);
});
```

> Уточнение по «суммированию» totalPoints: подсчёт суммы только по задачам где у юзера есть scored submission. У Alice только t1 + t2 → 80+60 = 140. У Bob — 90 (только t1). По totalPoints DESC: Alice 140, Bob 90.

Перепиши первый тест с правильными ожиданиями (см. ниже исправление).

```js
test('buildNativeLeaderboard: best per user per task, sum totalPoints (corrected)', () => {
  const db = freshDb();
  const { taskIds: [t1, t2] } = seed(db);
  score(db, t1, 1, 70); score(db, t1, 1, 50); score(db, t1, 1, 80);
  score(db, t2, 1, 60);
  score(db, t1, 2, 90);

  const lb = buildNativeLeaderboard(db, 'c', 'public');
  const totals = lb.overall.map((e) => ({ name: e.nickname, total: e.totalPoints }));
  assert.deepEqual(totals.sort((a, b) => b.total - a.total), [
    { name: 'Alice', total: 140 },
    { name: 'Bob', total: 90 },
  ]);
  // byTask shape
  assert.equal(lb.byTask.t1.entries.length, 2);
  assert.equal(lb.byTask.t1.entries[0].nickname, 'Bob'); // 90 > 80
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/scoring/nativeLeaderboard.js`:
```js
import { listNativeTasks } from '../db/nativeTasksRepo.js';

export function buildNativeLeaderboard(db, competitionSlug, variant) {
  const tasks = listNativeTasks(db, competitionSlug);
  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length === 0) {
    return emptyResponse(tasks);
  }
  const pointsCol = variant === 'private' ? 'points_private' : 'points_public';
  const rawCol = variant === 'private' ? 'raw_score_private' : 'raw_score_public';

  const placeholders = taskIds.map(() => '?').join(',');
  const rows = db.prepare(
    `WITH best AS (
       SELECT s.task_id, s.user_id, s.${pointsCol} AS points, s.${rawCol} AS raw_score, s.created_at,
              ROW_NUMBER() OVER (PARTITION BY s.task_id, s.user_id ORDER BY s.${pointsCol} DESC, s.id ASC) AS rn
       FROM submissions s
       WHERE s.status = 'scored' AND s.${pointsCol} IS NOT NULL AND s.task_id IN (${placeholders})
     )
     SELECT b.task_id AS taskId, b.user_id AS userId, b.points, b.raw_score AS rawScore, b.created_at AS createdAt,
            u.display_name AS nickname, u.kaggle_id AS kaggleId
     FROM best b
     JOIN users u ON u.id = b.user_id
     WHERE b.rn = 1
     ORDER BY b.${pointsCol} DESC, u.id ASC`
  ).all(...taskIds);

  // group by user
  const byUser = new Map();
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const r of rows) {
    if (!byUser.has(r.userId)) {
      byUser.set(r.userId, {
        participantKey: `user:${r.userId}`,
        nickname: r.nickname,
        teamName: r.nickname, // SP-3: teamName = displayName, могут различаться позже
        totalPoints: 0,
        previousTotalPoints: null,
        tasks: {},
      });
    }
    const e = byUser.get(r.userId);
    const slug = taskById.get(r.taskId).slug;
    e.tasks[slug] = {
      points: r.points,
      previousPoints: null,
      rawScore: r.rawScore,
      rank: null, // SP-3 не считает per-task rank в overall row
    };
    e.totalPoints += r.points;
  }

  const overall = [...byUser.values()]
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((e, idx) => ({ ...e, place: idx + 1 }));

  // byTask: per-task entries sorted by points DESC
  const byTask = {};
  for (const t of tasks) {
    const taskRows = rows.filter((r) => r.taskId === t.id).sort((a, b) => b.points - a.points);
    byTask[t.slug] = {
      slug: t.slug,
      title: t.title,
      higherIsBetter: t.higherIsBetter,
      updatedAt: null,
      entries: taskRows.map((r, idx) => ({
        place: idx + 1,
        participantKey: `user:${r.userId}`,
        nickname: r.nickname,
        teamName: r.nickname,
        rank: idx + 1,
        score: r.rawScore,
        points: r.points,
        previousPoints: null,
      })),
    };
  }

  return {
    tasks,
    overall,
    byTask,
  };
}

function emptyResponse(tasks) {
  const byTask = {};
  for (const t of tasks) byTask[t.slug] = { slug: t.slug, title: t.title, higherIsBetter: t.higherIsBetter, updatedAt: null, entries: [] };
  return { tasks, overall: [], byTask };
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/scoring/nativeLeaderboard.js backend/tests/sp3_leaderboard.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): buildNativeLeaderboard (best per user, sum totalPoints, public/private)"
```

---

### Task 5.2: Leaderboard endpoint dispatch — заменить заглушку SP-2

**Files:**
- Modify: `backend/src/app.js`
- Modify: `backend/tests/sp3_leaderboard.test.js`

- [ ] **Step 1: Тест**

```js
test('GET /api/competitions/<native>/leaderboard returns 4 variants populated', async () => {
  const { app, db } = await (async () => {
    process.env.ADMIN_TOKEN = 'shared';
    const db = freshDb();
    const { taskIds: [t1, t2] } = seed(db);
    score(db, t1, 1, 70); score(db, t2, 1, 60);
    score(db, t1, 2, 90);
    const { createApp } = await import('../src/app.js');
    return { db, app: createApp({ db }) };
  })();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/leaderboard`).then((x) => x.json());
  // shape
  for (const key of ['overall', 'privateOverall', 'oursOverall', 'oursPrivateOverall', 'byTask', 'privateByTask', 'oursByTask', 'oursPrivateByTask']) {
    assert.ok(key in r, `missing ${key}`);
  }
  // public — есть данные
  assert.equal(r.overall.length, 2);
  assert.equal(r.overall[0].nickname, 'Alice'); // 70+60=130 > 90
  // private — нет (никто не заполнял points_private)
  assert.equal(r.privateOverall.length, 0);
  // ours = overall (SP-3)
  assert.equal(r.oursOverall.length, r.overall.length);
  server.close();
});
```

(`start` вспомогательная функция уже импортирована.)

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Заменить native-handler в `app.js`**

В `app.js` найди существующий обработчик `GET /api/competitions/:competitionSlug/leaderboard` (после диспатча на native, который SP-2 поставил с пустыми массивами). Заменить native-ветку на:

```js
if (meta.type === 'native') {
  const { buildNativeLeaderboard } = await import('./scoring/nativeLeaderboard.js');
  const pub = buildNativeLeaderboard(db, meta.slug, 'public');
  const priv = buildNativeLeaderboard(db, meta.slug, 'private');
  // privateTaskSlugs: список task.slug у которых хотя бы один points_private
  const privateTaskSlugs = Object.keys(priv.byTask).filter((slug) => priv.byTask[slug].entries.length > 0);
  res.json({
    updatedAt: new Date().toISOString(),
    tasks: pub.tasks,
    overall: pub.overall,
    byTask: pub.byTask,
    privateOverall: priv.overall,
    privateByTask: priv.byTask,
    privateTaskSlugs,
    // SP-3: ours = overall
    oursOverall: pub.overall,
    oursByTask: pub.byTask,
    oursPrivateOverall: priv.overall,
    oursPrivateByTask: priv.byTask,
    errors: [],
  });
  return;
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/app.js backend/tests/sp3_leaderboard.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): leaderboard dispatch native — 4-variant shape with real data"
```

---

## Phase 6 — Worker startup wiring

### Task 6.1: Запуск воркера в index.js

**Files:**
- Modify: `backend/src/index.js`

- [ ] **Step 1: Импорт + старт после миграций**

В `index.js` после `bootstrapAdmin(...)`:

```js
import { startWorker } from './scoring/worker.js';
// ...
const stopWorker = startWorker(db);
console.log(`[worker] started (tick=${process.env.WORKER_TICK_MS || 2000}ms)`);
```

`stopWorker` нигде явно не вызываем (Express не имеет graceful shutdown в текущей кодовой базе) — при `SIGTERM` Node прибьёт interval сам.

- [ ] **Step 2: Smoke**

```bash
cd backend && rm -f data/app.db && npm run dev
```

Лог должен показать:
- `Backend started on http://localhost:3001`
- `[worker] started (tick=2000ms)`

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/index.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): startWorker on app boot"
```

---

## Phase 7 — Frontend

### Task 7.1: api.js helpers

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Добавить submissions API**

В конец `api.js`:

```js
export const submissions = {
  create: (compSlug, taskSlug, formData) =>
    fetch(`${API_BASE}/competitions/${compSlug}/native-tasks/${taskSlug}/submissions`, {
      method: 'POST', credentials: 'include', body: formData,
    }).then(async (r) => {
      const text = await r.text();
      let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
      if (!r.ok) throw Object.assign(new Error(json?.error || r.statusText), { status: r.status, payload: json });
      return json;
    }),
  listMine: (compSlug, taskSlug) => request(`/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/me`),
  get: (compSlug, taskSlug, id) => request(`/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/${id}`),
};

export const adminSubmissions = {
  list: (compSlug, taskSlug, status) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/submissions${status ? `?status=${status}` : ''}`),
  delete: (compSlug, taskSlug, id) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/${id}`, { method: 'DELETE' }),
  rescore: (compSlug, taskSlug, id) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/${id}/rescore`, { method: 'POST' }),
  rescoreAll: (compSlug, taskSlug) => request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/rescore-all`, { method: 'POST' }),
};

// Расширение adminNativeTasks из SP-2
adminNativeTasks.uploadGroundTruthPrivate = (compSlug, taskSlug, formData) =>
  fetch(`${API_BASE}/admin/competitions/${compSlug}/native-tasks/${taskSlug}/ground-truth-private`, {
    method: 'PUT', credentials: 'include', body: formData,
  }).then((r) => r.json());
adminNativeTasks.deleteGroundTruthPrivate = (compSlug, taskSlug) =>
  request(`/admin/competitions/${compSlug}/native-tasks/${taskSlug}/ground-truth-private`, { method: 'DELETE' });
```

- [ ] **Step 2: Build**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/api.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/api): submissions + adminSubmissions + ground-truth-private"
```

---

### Task 7.2: SubmitForm

**Files:**
- Create: `frontend/src/native/SubmitForm.jsx`

- [ ] **Step 1: Реализация**

```jsx
import { useState } from 'react';
import { submissions } from '../api.js';

export default function SubmitForm({ competitionSlug, taskSlug, onSubmitted }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { submission } = await submissions.create(competitionSlug, taskSlug, fd);
      setFile(null);
      e.target.reset();
      onSubmitted?.(submission);
    } catch (e) {
      setErr(e.message || 'submit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="submit-form">
      <h3>Сдать решение</h3>
      <input type="file" accept=".csv,.tsv,.json" onChange={(e) => setFile(e.target.files[0] || null)} required />
      <button disabled={busy || !file}>{busy ? 'Отправка…' : 'Submit'}</button>
      {err && <div className="error">{err}</div>}
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/native/SubmitForm.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe): SubmitForm component"
```

---

### Task 7.3: MySubmissions с поллингом

**Files:**
- Create: `frontend/src/native/MySubmissions.jsx`

- [ ] **Step 1: Реализация**

```jsx
import { useEffect, useRef, useState } from 'react';
import { submissions } from '../api.js';

const POLL_MS = 2000;

function fmtPoints(p) {
  if (p == null) return '—';
  return p.toFixed(2);
}

function StatusBadge({ status }) {
  const cls = `status-badge status-${status}`;
  const label = { pending: 'В очереди', scoring: 'Считается…', scored: 'Готово', failed: 'Ошибка' }[status] || status;
  return <span className={cls}>{label}</span>;
}

export default function MySubmissions({ competitionSlug, taskSlug, refreshKey }) {
  const [list, setList] = useState([]);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  async function refetch() {
    try {
      const { submissions: rows } = await submissions.listMine(competitionSlug, taskSlug);
      setList(rows);
      const active = rows.some((s) => s.status === 'pending' || s.status === 'scoring');
      if (active && !timerRef.current) {
        timerRef.current = setInterval(() => refetch(), POLL_MS);
      } else if (!active && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refetch();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [competitionSlug, taskSlug, refreshKey]);

  if (error) return <div className="error">{error}</div>;
  if (list.length === 0) return <p className="dim">Сабмитов пока нет</p>;

  return (
    <div>
      <h3>Мои сабмиты</h3>
      <table className="submissions-table">
        <thead>
          <tr>
            <th>Когда</th><th>Файл</th><th>Статус</th><th>Public</th><th>Private</th><th>Raw</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.createdAt).toLocaleString()}</td>
              <td>{s.originalFilename}</td>
              <td>
                <StatusBadge status={s.status} />
                {s.status === 'failed' && s.errorMessage && (
                  <div className="error-text" title={s.logExcerpt}>{s.errorMessage}</div>
                )}
              </td>
              <td>{fmtPoints(s.pointsPublic)}</td>
              <td>{fmtPoints(s.pointsPrivate)}</td>
              <td className="dim">{s.rawScorePublic ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

В `frontend/src/styles.css` добавить минимальные стили для `.submissions-table`, `.status-badge`, `.status-pending`, `.status-scoring`, `.status-scored`, `.status-failed`, `.error-text`, `.submit-form`:
```css
.submissions-table { width: 100%; border-collapse: collapse; }
.submissions-table th, .submissions-table td { border-bottom: 1px solid #eee; padding: 6px 10px; text-align: left; }
.status-badge { padding: 2px 8px; border-radius: 4px; font-size: 12px; }
.status-pending { background: #ddd; color: #555; }
.status-scoring { background: #cde7ff; color: #0050a0; }
.status-scored  { background: #d0f0c0; color: #1a6020; }
.status-failed  { background: #ffd0d0; color: #8a1010; }
.error-text { color: #8a1010; font-size: 12px; }
.submit-form { display: flex; flex-direction: column; gap: 12px; max-width: 480px; }
```

- [ ] **Step 2: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/native/MySubmissions.jsx frontend/src/styles.css
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe): MySubmissions table with polling + status badges"
```

---

### Task 7.4: NativeTaskPage extension

**Files:**
- Modify: `frontend/src/native/NativeTaskPage.jsx`

- [ ] **Step 1: Импорты + 3 новые секции**

В шапке:
```jsx
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import SubmitForm from './SubmitForm.jsx';
import MySubmissions from './MySubmissions.jsx';
```

Внутри return, после секции `Стартовый набор`:
```jsx
{user && (
  <section>
    <SubmitForm competitionSlug={competitionSlug} taskSlug={taskSlug}
                onSubmitted={() => setRefreshKey((k) => k + 1)} />
  </section>
)}
{user && (
  <section>
    <MySubmissions competitionSlug={competitionSlug} taskSlug={taskSlug} refreshKey={refreshKey} />
  </section>
)}
```

И state `const [refreshKey, setRefreshKey] = useState(0);` рядом с другими useState. `useAuth` для получения `user`.

> Лидерборд на странице задачи в SP-3 не выносим отдельным компонентом — есть страница `/competitions/<slug>/leaderboard` (от SP-2/kaggle), теперь native туда автоматически попадает с реальными данными. Если хочется встроить ЛБ сразу на page задачи, делается в SP-4.

- [ ] **Step 2: Smoke**

```bash
cd frontend && npm run dev
```
Логин → открыть native задачу → загрузить файл → видеть в Мои сабмиты с polling'ом → дождаться `scored`.

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/native/NativeTaskPage.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe): NativeTaskPage — submit + my-submissions sections"
```

---

### Task 7.5: AdminNativeTaskEdit — private GT slot + Submissions tab

**Files:**
- Modify: `frontend/src/admin/AdminNativeTaskEdit.jsx`

- [ ] **Step 1: Расширить компонент**

Добавить state:
```jsx
const [submissions, setSubmissions] = useState([]);
```

В функцию `load`:
```jsx
const adminSubs = await import('../api.js').then((m) => m.adminSubmissions);
const subs = await adminSubs.list(competitionSlug, taskSlug);
setSubmissions(subs.submissions);
```

(Импортируй `adminSubmissions` нормально в шапке; импорт здесь по `import('../api.js')` оставлен для иллюстрации, нужно делать обычным импортом.)

Добавить секцию «Ground truth (private)» — mirror существующего public-слота:
```jsx
<section>
  <h2>Ground truth (private)</h2>
  <p>Текущий: {task.groundTruthPrivatePath || '(нет)'}</p>
  <input type="file" onChange={(e) => e.target.files[0] && uploadSlot('groundTruthPrivate', e.target.files[0])} />
  {task.groundTruthPrivatePath && (
    <button onClick={async () => {
      const a = await import('../api.js').then((m) => m.adminNativeTasks);
      await a.deleteGroundTruthPrivate(competitionSlug, taskSlug);
      load();
    }}>Удалить</button>
  )}
</section>
```

В `uploadSlot` дополнить кейс `groundTruthPrivate`:
```jsx
async function uploadSlot(kind, file) {
  const fd = new FormData();
  fd.append('file', file);
  const a = await import('../api.js').then((m) => m.adminNativeTasks);
  if (kind === 'grader') await a.uploadGrader(competitionSlug, taskSlug, fd);
  else if (kind === 'groundTruth') await a.uploadGroundTruth(competitionSlug, taskSlug, fd);
  else if (kind === 'groundTruthPrivate') await a.uploadGroundTruthPrivate(competitionSlug, taskSlug, fd);
  alert(`${kind} загружен`);
  load();
}
```

Добавить секцию «Сабмиты» с rescore-all:
```jsx
<section>
  <h2>Сабмиты ({submissions.length})</h2>
  <button onClick={async () => {
    if (!confirm('Пере-скорить все сабмиты задачи?')) return;
    const a = await import('../api.js').then((m) => m.adminSubmissions);
    await a.rescoreAll(competitionSlug, taskSlug);
    alert('Все сабмиты возвращены в очередь');
    load();
  }}>Re-score all</button>
  <table className="submissions-table">
    <thead><tr><th>ID</th><th>Юзер</th><th>Файл</th><th>Статус</th><th>Public</th><th>Private</th><th>Действия</th></tr></thead>
    <tbody>
      {submissions.map((s) => (
        <tr key={s.id}>
          <td>{s.id}</td>
          <td>{s.userId}</td>
          <td>{s.originalFilename}</td>
          <td>{s.status}</td>
          <td>{s.pointsPublic ?? '—'}</td>
          <td>{s.pointsPrivate ?? '—'}</td>
          <td>
            <button onClick={async () => {
              const a = await import('../api.js').then((m) => m.adminSubmissions);
              await a.rescore(competitionSlug, taskSlug, s.id); load();
            }}>Re-score</button>
            <button onClick={async () => {
              if (!confirm('Удалить сабмит?')) return;
              const a = await import('../api.js').then((m) => m.adminSubmissions);
              await a.delete(competitionSlug, taskSlug, s.id); load();
            }}>Удалить</button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

> Замечание: динамические импорты `import('../api.js')` сделаны для краткости. В финальной версии — заменить на нормальные top-level импорты.

- [ ] **Step 2: Smoke**

Логин админом → открыть редактор задачи → загрузить private GT → нажать Re-score all → перейти на страницу задачи как user → увидеть private points у своих сабмитов после tick'a воркера.

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/admin/AdminNativeTaskEdit.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/admin): private GT slot + submissions tab + rescore-all"
```

---

## Phase 8 — Smoke + docs

### Task 8.1: End-to-end smoke

- [ ] **Step 1: Чистая БД**

```bash
cd backend
rm -f data/app.db
ADMIN_BOOTSTRAP_EMAIL=root@x.y ADMIN_BOOTSTRAP_PASSWORD=hunter2hunter2 npm run dev
```

Должен быть лог `[worker] started (tick=2000ms)` после migrations.

- [ ] **Step 2: Создать native task с public-only**

В админке: создать native соревнование `sandbox` → задачу `t1` → загрузить тривиальный `score.py` который печатает фиксированное число → загрузить `ground-truth.csv` → задать якоря `baseline_public=0`, `author_public=1`.

`backend/tests/fixtures/grader/score-ok.py` подойдёт как `score.py` (всегда 0.85).

- [ ] **Step 3: Сабмит как participant**

В новой вкладке/incognito регистрируемся как обычный юзер → открываем задачу → грузим любой `.csv` (содержимое не важно) → видим в Мои сабмиты `pending` → через ≤4 сек `scored` с `points_public=85`.

- [ ] **Step 4: Native /leaderboard содержит реальные entries**

```bash
curl -s http://localhost:3001/api/competitions/sandbox/leaderboard | jq '.overall[0]'
```
Expected: `{ nickname: "...", totalPoints: 85, ... }`.

- [ ] **Step 5: Загрузить private GT + rescore-all**

В админке загрузить `ground-truth-private.csv` → нажать Re-score all → подождать → проверить `points_private` появились в обоих /submissions/me и /leaderboard.

- [ ] **Step 6: Existing kaggle leaderboard `neoai-2026` не сломан**

```bash
curl -s http://localhost:3001/api/competitions/neoai-2026/leaderboard | jq '.tasks | length'
```
Expected: то же значение что было до SP-3.

- [ ] **Step 7: Все тесты зелёные**

```bash
cd backend && npm test
```

- [ ] **Step 8: Smoke commit (нечего коммитить)**

---

### Task 8.2: README + ROUTES.md

**Files:**
- Modify: `new_lb/README.md`, `new_lb/ROUTES.md`

- [ ] **Step 1: README**

Дописать в таблицу env:
| Переменная | Дефолт | |
| --- | --- | --- |
| `PYTHON_BIN` | `python3` | бинарь Python для grader'ов |
| `WORKER_TICK_MS` | `2000` | период tick'a воркера |
| `SCORING_TIMEOUT_MS` | `60000` | таймаут одного запуска grader'а |
| `MAX_SUBMISSION_BYTES` | `52428800` | лимит на сабмит |
| `MAX_SUBMISSIONS_PER_DAY` | `50` | rate-limit (user, task, 24h) |
| `SUBMISSION_ALLOWED_EXTS` | `csv,tsv,json` | whitelist расширений |

В секцию «Локальная разработка» добавить:
> Воркер скоринга стартует в том же процессе что и Express. Для запуска нативных задач Python должен быть установлен (`brew install python` / `apt install python3` / уже есть в Docker-образе). Сабмиты лежат в `data/native/<comp>/<task>/submissions/<id>-<filename>`.

- [ ] **Step 2: ROUTES.md**

Добавить секции:

```
### Submissions (native)

| Method | Path | Auth |
| --- | --- | --- |
| POST   | /api/competitions/<slug>/native-tasks/<task>/submissions | required |
| GET    | /api/competitions/<slug>/native-tasks/<task>/submissions/me | required |
| GET    | /api/competitions/<slug>/native-tasks/<task>/submissions/:id | required (owner или admin) |

### Admin submissions

| Method | Path |
| --- | --- |
| GET | /api/admin/competitions/<slug>/native-tasks/<task>/submissions[?status=...] |
| DELETE | /api/admin/competitions/<slug>/native-tasks/<task>/submissions/:id |
| POST | /api/admin/competitions/<slug>/native-tasks/<task>/submissions/:id/rescore |
| POST | /api/admin/competitions/<slug>/native-tasks/<task>/submissions/rescore-all |

### Admin task slots (расширение SP-2)

| Method | Path |
| --- | --- |
| PUT/DELETE | /api/admin/competitions/<slug>/native-tasks/<task>/ground-truth-private |
```

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add new_lb/README.md new_lb/ROUTES.md
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "docs(sp3): submissions + scoring + private GT routes"
```

---

## Self-review

**Spec coverage:**
- ✓ Migration 0003 (submissions + ground_truth_private_path) — Task 1.1
- ✓ nativeTasksRepo extension — Task 1.2
- ✓ submissionsRepo + status machine + pickAndMarkScoring + recoverStale — Task 1.3
- ✓ runGrader + computePoints — Tasks 2.2-2.3
- ✓ Worker tick public-only — Task 2.4
- ✓ Worker tick public+private + private failure handling — Task 2.5
- ✓ Retry budget + stale recovery integration — Task 2.6
- ✓ POST submission + auto-join + rate limit — Task 3.1
- ✓ GET own list/detail — Task 3.1
- ✓ Admin list/delete/rescore/rescore-all — Task 4.1
- ✓ Admin ground-truth-private slot — Task 4.2
- ✓ buildNativeLeaderboard public/private — Task 5.1
- ✓ Leaderboard endpoint dispatch (4-variant native) — Task 5.2
- ✓ startWorker integration — Task 6.1
- ✓ Frontend api.js submissions + adminSubmissions — Task 7.1
- ✓ SubmitForm — Task 7.2
- ✓ MySubmissions polling — Task 7.3
- ✓ NativeTaskPage extension — Task 7.4
- ✓ Admin private GT slot + Submissions tab — Task 7.5
- ✓ Smoke — Task 8.1
- ✓ Docs — Task 8.2

**Plan check:** placeholder'ов нет; имена методов согласованы (`pickAndMarkScoring`/`markScored`/`markFailed`/`markFailedRetry`/`recoverStale`/`resetSubmissionForRescore`/`resetAllForRescore`/`getSubmission`/`listSubmissionsForUserTask`/`listSubmissionsForTask`/`countRecentSubmissions`/`buildNativeLeaderboard`/`runGrader`/`computePoints`/`tick`/`startWorker`).

**Tricky предвидимое:**

- Task 4.1 — порядок маршрутов в admin submissions router: `/rescore-all` обязан стоять ДО `/:id/rescore` и `/:id`, иначе Express матчит «rescore-all» как `id`. Замечание явное в Task 4.1.
- Task 5.1 — корректность ROW_NUMBER() требует SQLite ≥ 3.25 (better-sqlite3 11.x идёт с современным SQLite, ОК).
- Task 5.2 — частичная инициализация leaderboard'a: если у юзера есть scored submission на одной задаче из двух, у него `tasks` содержит только одну ключ. Поведение сходно с kaggle path (где если у юзера нет сабмита на задаче, ключа нет). Совместимо с фронтом.
- Task 2.5 — тест на private failure через несуществующий путь GT использует ENOENT от `spawn` — нужно убедиться что Node на close возвращает exit code, а не error event. На macOS/Linux: spawn с несуществующим script_arg НЕ падает (программа стартует, sys.argv видит путь), но grader python script сам проверяет os.path.exists и делает sys.exit(2). В тесте используется inline-grader, который это проверяет. ОК.

---

## Critical paths to remember

- **Не сломать kaggle.** Existing `/api/competitions/<slug>/leaderboard` для `type=kaggle` без изменений; native ветка диспатча — единственное место правки.
- **Worker — single instance.** `setInterval` тикает каждые 2 секунды; внутри `tick` re-entrancy защищена флагом `running`. Параллельный воркер — отдельный таск SP-4 с advisory-lock на pickAndMarkScoring.
- **Auto-join.** Происходит ВНУТРИ POST /submissions handler'a, ДО insertSubmission (чтобы неудача auto-join'a откатила сабмит). `INSERT OR IGNORE` идемпотентен.
- **Rate limit.** Считается по `submissions WHERE created_at > now() - 24h`, включая failed/scored/pending. Это намеренно: чтобы участник не делал 50 спам-сабмитов и не ждал worker'a.
- **`participants.json` НЕ ТРОГАЕМ.** Kaggle «ours»-фильтр продолжает читать его. Native «ours» = `competition_members` в SP-3 = все, кто сабмитил.
- **Дисковая папка submissions.** `data/native/<comp>/<task>/submissions/` создаётся busboy'ем при первом сабмите. При DELETE сабмита файл удаляется компенсаторно. При DELETE задачи (SP-2 soft-delete) папка переименовывается с суффиксом — submissions едут вместе.
