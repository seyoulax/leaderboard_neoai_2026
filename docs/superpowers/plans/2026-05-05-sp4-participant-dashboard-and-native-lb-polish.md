# SP-4 — Participant Dashboard & Native LB Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Финальный stretch до MVP — личный кабинет (`/me`), явный join/leave, Kaggle-style «selected» сабмиты с fallback, deltas на native-лидерборде через in-memory snapshot, OBS-оверлеи для native «бесплатно» через идентичный response shape.

**Architecture:** Расширяем SP-1..SP-3: schema-миграция 0004 (добавляет `submissions.selected` + 2 partial-индекса). Бэкенд получает `/api/me/*` namespace для кабинета и `/api/competitions/<slug>/{join,members/me,membership}` для участия. Native-deltas — `Map<slug, snapshot>` в памяти процесса, обновляется через хук `onScored(slug)` в worker'е после `markScored`; идентично kaggle pipeline'у. Selected — флаг в `submissions`, max 2 per (user, task); private-LB query использует `FULL OUTER JOIN` selected_best+overall_best с COALESCE как fallback. Фронт — кабинет (`/me`, `/me/submissions`, `/me/competitions`), JoinButton на странице соревнования, «Selected» чекбокс в MySubmissions из SP-3.

**Tech Stack:** Без новых dependencies. Node 20 + Express + `node:test`, `better-sqlite3` (SQLite 3.45+ с FULL OUTER JOIN), React 18 + Vite.

**Spec:** `docs/superpowers/specs/2026-05-05-sp4-participant-dashboard-and-native-lb-polish-design.md`

**Prereq:** SP-3 уже в main (см. `sp3_done.md`) — нужны таблицы submissions с public/private points + worker + buildNativeLeaderboard.

---

## File Structure

### Backend

| File | Status | Responsibility |
| --- | --- | --- |
| `backend/src/db/migrations/0004_selected_and_indexes.sql` | **create** | ALTER submissions ADD selected + 2 индекса |
| `backend/src/db/usersRepo.js` | modify | +updateUserProfile, +updatePassword |
| `backend/src/db/competitionMembersRepo.js` | **create** | join/leave/isMember/listForUser |
| `backend/src/db/submissionsRepo.js` | modify | +setSelected, +countSelectedForUserTask, +listAllByUser |
| `backend/src/scoring/snapshotCache.js` | **create** | in-memory native snapshots + annotateDeltas |
| `backend/src/scoring/worker.js` | modify | hook onScored(slug) после markScored |
| `backend/src/scoring/nativeLeaderboard.js` | modify | private variant с selected fallback |
| `backend/src/routes/me.js` | **create** | GET/PATCH /me, POST /me/password, /me/competitions, /me/submissions |
| `backend/src/routes/membership.js` | **create** | POST join, DELETE members/me, GET membership |
| `backend/src/routes/submissionsPublic.js` | modify | +PUT /:id/select |
| `backend/src/app.js` | modify | mount routes; leaderboard читает snapshot |
| `backend/tests/sp4_users.test.js` | **create** | updateProfile + updatePassword |
| `backend/tests/sp4_members.test.js` | **create** | competitionMembersRepo |
| `backend/tests/sp4_selected.test.js` | **create** | setSelected + private LB с selected |
| `backend/tests/sp4_snapshots.test.js` | **create** | snapshotCache annotateDeltas |
| `backend/tests/sp4_me.test.js` | **create** | /me endpoints integration |
| `backend/tests/sp4_membership.test.js` | **create** | join/leave/membership endpoints |

### Frontend

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/src/api.js` | modify | me/membership/submissions.toggleSelected helpers |
| `frontend/src/me/MePage.jsx` | **create** | главная кабинета — обёртка |
| `frontend/src/me/ProfileSection.jsx` | **create** | edit email/displayName/kaggleId |
| `frontend/src/me/PasswordSection.jsx` | **create** | change password form |
| `frontend/src/me/MyCompetitions.jsx` | **create** | список соревнований + место + leave |
| `frontend/src/me/MySubmissionsCabinet.jsx` | **create** | плоский список всех сабмитов |
| `frontend/src/competition/JoinButton.jsx` | **create** | join state на странице соревнования |
| `frontend/src/native/NativeTaskPage.jsx` | modify | подключить JoinButton |
| `frontend/src/native/MySubmissions.jsx` | modify | +колонка «Selected» с toggle |
| `frontend/src/UserMenu.jsx` | modify | link «Личный кабинет» |
| `frontend/src/App.jsx` | modify | routes /me, /me/submissions, /me/competitions |
| `frontend/src/styles.css` | modify | минимальные стили кабинета |

### Docs

| File | Status |
| --- | --- |
| `new_lb/README.md` | modify (cabinet + selected секции) |
| `new_lb/ROUTES.md` | modify (новые endpoints) |

---

## Phase 0 — Подготовка

### Task 0.1: Worktree от main + baseline tests

Этот таск выполняет controller (или ручным flow). Все остальные задачи делаются внутри worktree.

- [ ] **Step 1: Создать worktree от main**

```bash
cd /Users/seyolax/projects/neoai-transa/new_lb
git worktree add .claude/worktrees/sp4-cabinet -b worktree-sp4-cabinet main
cd .claude/worktrees/sp4-cabinet/backend && npm install
cd ../frontend && npm install
```

- [ ] **Step 2: Baseline тесты зелёные**

```bash
cd backend && npm test
```
Expected: все sp1+sp2+sp3 тесты проходят (~161+ tests).

- [ ] **Step 3: (Если используется git-команды через bash в этой среде)** все git'ы — с `GIT_TERMINAL_PROMPT=0 git --no-pager` префиксом, см. `feedback_git_in_sandbox.md`.

---

## Phase 1 — Schema + repos

### Task 1.1: Migration 0004

**Files:**
- Create: `backend/src/db/migrations/0004_selected_and_indexes.sql`
- Create: `backend/tests/sp4_selected.test.js`

- [ ] **Step 1: Падающий тест**

`backend/tests/sp4_selected.test.js`:
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

test('migration 0004: applied after 0001-0003', () => {
  const db = freshDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((r) => r.version), [1, 2, 3, 4]);
});

test('migration 0004: submissions.selected column exists with default 0', () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(submissions)").all();
  const sel = cols.find((c) => c.name === 'selected');
  assert.ok(sel, 'selected column missing');
  assert.equal(sel.dflt_value, '0');
  assert.equal(sel.notnull, 1);
});

test('migration 0004: selected CHECK constraint', () => {
  const db = freshDb();
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  assert.throws(
    () => db.prepare(`INSERT INTO submissions
      (task_id, user_id, original_filename, size_bytes, sha256, path, selected)
      VALUES (1, 1, 'x', 1, 'h', '/x', 5)`).run(),
    /CHECK/i
  );
});

test('migration 0004: existing submission rows get selected=0', () => {
  // регрессия: симулируем БД где была submissions без selected, потом 0004 накатилась
  const db = new Database(':memory:');
  // прогоняем 0001-0003 руками
  const fs = require('node:fs');
  const path = require('node:path');
  const MIG_DIR = path.resolve('src/db/migrations');
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)");
  for (const v of [1, 2, 3]) {
    const sql = fs.readFileSync(path.join(MIG_DIR, `000${v}_${['init', 'native_tasks', 'submissions'][v-1]}.sql`), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(v);
  }
  // вставляем существующую submission с pre-0004 schema
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  db.prepare(`INSERT INTO submissions (task_id, user_id, original_filename, size_bytes, sha256, path)
              VALUES (1, 1, 'x', 1, 'h', '/x')`).run();
  // применяем 0004
  const sql4 = fs.readFileSync(path.join(MIG_DIR, '0004_selected_and_indexes.sql'), 'utf8');
  db.exec(sql4);
  const got = db.prepare("SELECT selected FROM submissions WHERE id = 1").get();
  assert.equal(got.selected, 0);
});
```

> Замечание: 4-й тест использует `require` — в ESM-only коде нужно перевести в `import`. Корректная шапка теста:
> ```js
> import fs from 'node:fs';
> import path from 'node:path';
> import { fileURLToPath } from 'node:url';
> const __dirname = path.dirname(fileURLToPath(import.meta.url));
> const MIG_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
> ```
> Внутри теста — `fs.readFileSync(path.join(MIG_DIR, ...))`. И file-имена 0001-0003 могут отличаться: проверь точные имена через `fs.readdirSync(MIG_DIR)` и используй их.

- [ ] **Step 2: Run — FAIL** (миграция не существует)

```bash
cd backend && node --test tests/sp4_selected.test.js
```

- [ ] **Step 3: Создать миграцию**

`backend/src/db/migrations/0004_selected_and_indexes.sql`:
```sql
ALTER TABLE submissions ADD COLUMN selected INTEGER NOT NULL DEFAULT 0
  CHECK (selected IN (0, 1));

CREATE INDEX submissions_selected
  ON submissions (task_id, user_id, id)
  WHERE selected = 1 AND status = 'scored';

CREATE INDEX submissions_selected_score_private
  ON submissions (task_id, user_id, points_private DESC, id)
  WHERE selected = 1 AND status = 'scored' AND points_private IS NOT NULL;
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/migrations/0004_selected_and_indexes.sql backend/tests/sp4_selected.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): migration 0004 — submissions.selected + indexes"
```

---

### Task 1.2: usersRepo.updateUserProfile + updatePassword

**Files:**
- Modify: `backend/src/db/usersRepo.js`
- Create: `backend/tests/sp4_users.test.js`

- [ ] **Step 1: Падающие тесты**

`backend/tests/sp4_users.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createUser, findUserById, updateUserProfile, updateUserPassword } from '../src/db/usersRepo.js';
import { hashPassword, verifyPassword } from '../src/auth/bcrypt.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

test('updateUserProfile: меняет displayName/email/kaggleId', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'old' });
  updateUserProfile(db, u.id, { email: 'b@b.b', displayName: 'B', kaggleId: 'NEW' });
  const got = findUserById(db, u.id);
  assert.equal(got.email, 'b@b.b');
  assert.equal(got.displayName, 'B');
  assert.equal(got.kaggleId, 'new');  // lowercased
});

test('updateUserProfile: partial update', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'k' });
  updateUserProfile(db, u.id, { displayName: 'NEW' });
  const got = findUserById(db, u.id);
  assert.equal(got.email, 'a@a.a');
  assert.equal(got.displayName, 'NEW');
  assert.equal(got.kaggleId, 'k');
});

test('updateUserProfile: kaggleId=null clears', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'k' });
  updateUserProfile(db, u.id, { kaggleId: null });
  assert.equal(findUserById(db, u.id).kaggleId, null);
});

test('updateUserProfile: email collision throws', () => {
  const db = freshDb();
  createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const u = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'B' });
  assert.throws(() => updateUserProfile(db, u.id, { email: 'a@a.a' }), /UNIQUE/i);
});

test('updateUserPassword: меняет hash', async () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('old'), displayName: 'A' });
  await updateUserPassword(db, u.id, await hashPassword('new'));
  const got = findUserById(db, u.id);
  assert.equal(await verifyPassword('new', got.passwordHash), true);
  assert.equal(await verifyPassword('old', got.passwordHash), false);
});
```

- [ ] **Step 2: FAIL** (функции отсутствуют)

- [ ] **Step 3: Расширить `usersRepo.js`**

Добавить в конец `backend/src/db/usersRepo.js`:
```js
const PROFILE_UPDATABLE = {
  email: 'email',
  displayName: 'display_name',
  kaggleId: 'kaggle_id',
};

export function updateUserProfile(db, id, patch) {
  const sets = [];
  const vals = [];
  for (const [k, col] of Object.entries(PROFILE_UPDATABLE)) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'kaggleId') v = v == null ? null : String(v).trim().toLowerCase() || null;
    if (k === 'email') v = String(v).trim().toLowerCase();
    if (k === 'displayName') v = String(v).trim();
    sets.push(`${col} = ?`);
    vals.push(v);
  }
  if (!sets.length) return findUserById(db, id);
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return findUserById(db, id);
}

export function updateUserPassword(db, id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/usersRepo.js backend/tests/sp4_users.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): usersRepo — updateUserProfile + updateUserPassword"
```

---

### Task 1.3: competitionMembersRepo

**Files:**
- Create: `backend/src/db/competitionMembersRepo.js`
- Create: `backend/tests/sp4_members.test.js`

- [ ] **Step 1: Падающие тесты**

`backend/tests/sp4_members.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import {
  joinCompetition,
  leaveCompetition,
  isMember,
  listMembershipsForUser,
} from '../src/db/competitionMembersRepo.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

function seed(db) {
  insertCompetition(db, { slug: 'c1', title: 'C1', type: 'native', visibility: 'public' });
  insertCompetition(db, { slug: 'c2', title: 'C2', type: 'native', visibility: 'public' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  return u.id;
}

test('joinCompetition: idempotent (INSERT IGNORE)', () => {
  const db = freshDb();
  const userId = seed(db);
  const r1 = joinCompetition(db, 'c1', userId);
  assert.equal(r1.alreadyMember, false);
  const r2 = joinCompetition(db, 'c1', userId);
  assert.equal(r2.alreadyMember, true);
  assert.equal(isMember(db, 'c1', userId), true);
});

test('leaveCompetition: deletes row', () => {
  const db = freshDb();
  const userId = seed(db);
  joinCompetition(db, 'c1', userId);
  assert.equal(isMember(db, 'c1', userId), true);
  leaveCompetition(db, 'c1', userId);
  assert.equal(isMember(db, 'c1', userId), false);
});

test('listMembershipsForUser: возвращает с joinedAt', () => {
  const db = freshDb();
  const userId = seed(db);
  joinCompetition(db, 'c1', userId);
  joinCompetition(db, 'c2', userId);
  const list = listMembershipsForUser(db, userId);
  assert.equal(list.length, 2);
  assert.ok(list[0].joinedAt);
  assert.ok(list.find((m) => m.competitionSlug === 'c1'));
  assert.ok(list.find((m) => m.competitionSlug === 'c2'));
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/db/competitionMembersRepo.js`:
```js
export function joinCompetition(db, competitionSlug, userId) {
  const result = db.prepare(
    `INSERT OR IGNORE INTO competition_members (competition_slug, user_id) VALUES (?, ?)`
  ).run(competitionSlug, userId);
  return { alreadyMember: result.changes === 0 };
}

export function leaveCompetition(db, competitionSlug, userId) {
  return db.prepare(
    `DELETE FROM competition_members WHERE competition_slug = ? AND user_id = ?`
  ).run(competitionSlug, userId).changes;
}

export function isMember(db, competitionSlug, userId) {
  const row = db.prepare(
    `SELECT 1 FROM competition_members WHERE competition_slug = ? AND user_id = ?`
  ).get(competitionSlug, userId);
  return !!row;
}

export function getMembership(db, competitionSlug, userId) {
  return db.prepare(
    `SELECT competition_slug AS competitionSlug, user_id AS userId, joined_at AS joinedAt
     FROM competition_members
     WHERE competition_slug = ? AND user_id = ?`
  ).get(competitionSlug, userId) || null;
}

export function listMembershipsForUser(db, userId) {
  return db.prepare(
    `SELECT competition_slug AS competitionSlug, user_id AS userId, joined_at AS joinedAt
     FROM competition_members
     WHERE user_id = ?
     ORDER BY joined_at DESC`
  ).all(userId);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/competitionMembersRepo.js backend/tests/sp4_members.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): competitionMembersRepo (join/leave/isMember/list)"
```

---

### Task 1.4: submissionsRepo.setSelected + countSelected + listAllByUser

**Files:**
- Modify: `backend/src/db/submissionsRepo.js`
- Modify: `backend/tests/sp4_selected.test.js`

- [ ] **Step 1: Тесты**

Добавить в `sp4_selected.test.js`:
```js
import {
  insertSubmission,
  getSubmission,
  pickAndMarkScoring,
  markScored,
  setSubmissionSelected,
  countSelectedForUserTask,
  listAllSubmissionsForUser,
} from '../src/db/submissionsRepo.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import { insertNativeTask } from '../src/db/nativeTasksRepo.js';

function seedTaskAndUser(db) {
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  return { taskId: t.id, userId: u.id };
}

function makeScoredSub(db, taskId, userId, points) {
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: '/x' });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: points / 100, pointsPublic: points, log: '', durationMs: 1 });
  return s.id;
}

test('setSubmissionSelected: помечает', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const id = makeScoredSub(db, taskId, userId, 70);
  setSubmissionSelected(db, id, true);
  assert.equal(getSubmission(db, id).selected, 1);
  setSubmissionSelected(db, id, false);
  assert.equal(getSubmission(db, id).selected, 0);
});

test('countSelectedForUserTask: 0/1/2', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const a = makeScoredSub(db, taskId, userId, 70);
  const b = makeScoredSub(db, taskId, userId, 80);
  assert.equal(countSelectedForUserTask(db, userId, taskId), 0);
  setSubmissionSelected(db, a, true);
  assert.equal(countSelectedForUserTask(db, userId, taskId), 1);
  setSubmissionSelected(db, b, true);
  assert.equal(countSelectedForUserTask(db, userId, taskId), 2);
});

test('listAllSubmissionsForUser: across tasks DESC by created_at', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const t2 = insertNativeTask(db, { competitionSlug: 'c', slug: 't2', title: 'T2' });
  makeScoredSub(db, taskId, userId, 70);
  makeScoredSub(db, t2.id, userId, 80);
  const list = listAllSubmissionsForUser(db, userId, { limit: 50 });
  assert.equal(list.length, 2);
  // самый новый — первый
  assert.ok(list[0].createdAt >= list[1].createdAt);
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Расширить `submissionsRepo.js`**

Добавить (там где остальной репо-код):
```js
// COLS уже определена в submissionsRepo. Расширить списком если selected отсутствует:
// Найди строку `created_at AS createdAt` и добавь перед ней:
//   selected,
// если её там ещё нет.

// в начало COLS уже включён 'selected' если был добавлен. Проверь и при необходимости:
// const COLS = `... selected, created_at AS createdAt`;

export function setSubmissionSelected(db, id, selected) {
  db.prepare('UPDATE submissions SET selected = ? WHERE id = ?').run(selected ? 1 : 0, id);
}

export function countSelectedForUserTask(db, userId, taskId) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM submissions
     WHERE user_id = ? AND task_id = ? AND selected = 1 AND status = 'scored'`
  ).get(userId, taskId).n;
}

export function listAllSubmissionsForUser(db, userId, { limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  return db.prepare(
    `SELECT s.id, s.task_id AS taskId, s.user_id AS userId,
            s.original_filename AS originalFilename, s.size_bytes AS sizeBytes,
            s.status, s.raw_score_public AS rawScorePublic,
            s.points_public AS pointsPublic, s.points_private AS pointsPrivate,
            s.selected, s.error_message AS errorMessage,
            s.created_at AS createdAt, s.scored_at AS scoredAt,
            t.slug AS taskSlug, t.title AS taskTitle, t.competition_slug AS competitionSlug
     FROM submissions s
     JOIN native_tasks t ON t.id = s.task_id
     WHERE s.user_id = ?
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT ? OFFSET ?`
  ).all(userId, safeLimit, safeOffset);
}
```

> Важно: проверь что `COLS` константа в submissionsRepo.js (которая уже есть) включает `selected` после миграции 0004. Если нет — добавь `selected,` в эту строку. После этого `getSubmission` будет возвращать `selected` в результате.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/submissionsRepo.js backend/tests/sp4_selected.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(db): submissionsRepo — setSelected + countSelected + listAllByUser"
```

---

## Phase 2 — `/api/me/*` endpoints

### Task 2.1: GET /api/me + PATCH /api/me

**Files:**
- Create: `backend/src/routes/me.js`
- Modify: `backend/src/app.js`
- Create: `backend/tests/sp4_me.test.js`

- [ ] **Step 1: Тесты integration**

`backend/tests/sp4_me.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

async function setup() {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const app = createApp({ db });
  return { db, app, userId: u.id, cookie: `${SESSION_COOKIE}=${sess.id}` };
}

async function start(app) {
  return new Promise((r) => { const s = app.listen(0, () => r(s)); });
}

test('GET /api/me: возвращает профиль', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(r.user.email, 'a@a.a');
  assert.equal(r.user.role, 'participant');
  server.close();
});

test('GET /api/me: 401 анониму', async () => {
  const { app } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me`);
  assert.equal(r.status, 401);
  server.close();
});

test('PATCH /api/me: меняет displayName', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ displayName: 'New Name' }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.user.displayName, 'New Name');
  server.close();
});

test('PATCH /api/me: email collision → 400', async () => {
  const { db, app, cookie } = await setup();
  // создаём другого юзера c email таким же как мы хотим взять
  createUser(db, { email: 'taken@x.x', passwordHash: 'h', displayName: 'Taken' });
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ email: 'taken@x.x' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('PATCH /api/me: невалидный email → 400', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ email: 'bad' }),
  });
  assert.equal(r.status, 400);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/routes/me.js`:
```js
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { findUserById, updateUserProfile, updateUserPassword } from '../db/usersRepo.js';
import { hashPassword, verifyPassword } from '../auth/bcrypt.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function userPublic(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, displayName: u.displayName,
    kaggleId: u.kaggleId, role: u.role, createdAt: u.createdAt,
  };
}

function validateProfilePatch(body) {
  const errors = [];
  const patch = {};
  if ('email' in body) {
    const e = String(body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 254) errors.push('invalid email');
    patch.email = e;
  }
  if ('displayName' in body) {
    const n = String(body.displayName || '').trim();
    if (!n || n.length > 80) errors.push('displayName must be 1–80 chars');
    patch.displayName = n;
  }
  if ('kaggleId' in body) {
    const k = body.kaggleId == null ? null : String(body.kaggleId).trim().toLowerCase();
    if (k && (!/^[a-z0-9-]+$/.test(k) || k.length > 80)) errors.push('invalid kaggleId');
    patch.kaggleId = k || null;
  }
  return { ok: errors.length === 0, errors, patch };
}

export function createMeRouter({ db }) {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    res.json({ user: userPublic(findUserById(db, req.user.id)) });
  });

  router.patch('/', requireAuth, (req, res) => {
    const v = validateProfilePatch(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });
    try {
      const updated = updateUserProfile(db, req.user.id, v.patch);
      res.json({ user: userPublic(updated) });
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) {
        return res.status(400).json({ error: 'email or kaggleId already in use' });
      }
      throw e;
    }
  });

  return router;
}
```

В `app.js`:
```js
import { createMeRouter } from './routes/me.js';
// после loadUser middleware:
app.use('/api/me', createMeRouter({ db }));
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/me.js backend/src/app.js backend/tests/sp4_me.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): GET/PATCH /api/me — profile read+update"
```

---

### Task 2.2: POST /api/me/password

**Files:**
- Modify: `backend/src/routes/me.js`
- Modify: `backend/tests/sp4_me.test.js`

- [ ] **Step 1: Тесты**

```js
test('POST /api/me/password: успех', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: 'p', newPassword: 'newhunter2' }),
  });
  assert.equal(r.status, 200);
  // Login с новым паролем работает
  const r2 = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@a.a', password: 'newhunter2' }),
  });
  assert.equal(r2.status, 200);
  server.close();
});

test('POST /api/me/password: неверный current → 400', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: 'WRONG', newPassword: 'newhunter2' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('POST /api/me/password: короткий new → 400', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: 'p', newPassword: 'short' }),
  });
  assert.equal(r.status, 400);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Endpoint в `me.js`**

```js
router.post('/password', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (next.length < 8 || next.length > 256) {
    return res.status(400).json({ error: 'newPassword must be 8–256 chars' });
  }
  const u = findUserById(db, req.user.id);
  if (!u || !(await verifyPassword(current, u.passwordHash))) {
    return res.status(400).json({ error: 'invalid current password' });
  }
  const hash = await hashPassword(next);
  updateUserPassword(db, req.user.id, hash);
  res.json({ ok: true });
});
```

> Замечание: `findUserById` сейчас в `usersRepo.js` НЕ возвращает `password_hash` (только пуб. поля). Нужна функция `findUserByIdWithHash` или расширение существующего. Проверь что возвращает `findUserById` — если без hash, добавить новую функцию или включить hash. Я ставлю в плане расширение через новую функцию:

В `backend/src/db/usersRepo.js` добавить (если ещё нет):
```js
export function findUserByIdWithHash(db, id) {
  return db.prepare(
    `SELECT id, email, password_hash AS passwordHash, display_name AS displayName,
            kaggle_id AS kaggleId, role, created_at AS createdAt
     FROM users WHERE id = ?`
  ).get(id) || null;
}
```

И в `me.js` использовать `findUserByIdWithHash` для проверки пароля:
```js
import { findUserByIdWithHash } from '../db/usersRepo.js';
// внутри handler:
const u = findUserByIdWithHash(db, req.user.id);
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/db/usersRepo.js backend/src/routes/me.js backend/tests/sp4_me.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): POST /api/me/password (verify old + bcrypt new)"
```

---

### Task 2.3: GET /api/me/competitions + GET /api/me/submissions

**Files:**
- Modify: `backend/src/routes/me.js`
- Modify: `backend/tests/sp4_me.test.js`

- [ ] **Step 1: Тесты**

```js
import { insertCompetition } from '../src/db/competitionsRepo.js';
import { insertNativeTask } from '../src/db/nativeTasksRepo.js';
import { joinCompetition } from '../src/db/competitionMembersRepo.js';
import { insertSubmission, pickAndMarkScoring, markScored } from '../src/db/submissionsRepo.js';

test('GET /api/me/competitions: возвращает соревнования где user — member', async () => {
  const { db, app, userId, cookie } = await setup();
  insertCompetition(db, { slug: 'c1', title: 'C1', type: 'native', visibility: 'public' });
  insertCompetition(db, { slug: 'c2', title: 'C2', type: 'native', visibility: 'public' });
  joinCompetition(db, 'c1', userId);
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/competitions`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(r.competitions.length, 1);
  assert.equal(r.competitions[0].slug, 'c1');
  server.close();
});

test('GET /api/me/competitions: добавляет totalPoints + place для native с сабмитами', async () => {
  const { db, app, userId, cookie } = await setup();
  insertCompetition(db, { slug: 'c1', title: 'C1', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c1', slug: 't', title: 'T', baselineScorePublic: 0, authorScorePublic: 1 });
  joinCompetition(db, 'c1', userId);
  // добавить scored submission с points=70
  const s = insertSubmission(db, { taskId: t.id, userId, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: '/x' });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: 0.7, pointsPublic: 70, log: '', durationMs: 1 });
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/competitions`, { headers: { cookie } }).then((x) => x.json());
  const c = r.competitions[0];
  assert.equal(c.totalPoints, 70);
  assert.equal(c.place, 1);
  server.close();
});

test('GET /api/me/submissions: возвращает все сабмиты user через native', async () => {
  const { db, app, userId, cookie } = await setup();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  insertSubmission(db, { taskId: t.id, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  insertSubmission(db, { taskId: t.id, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/submissions`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(r.submissions.length, 2);
  assert.equal(r.submissions[0].competitionSlug, 'c');
  assert.equal(r.submissions[0].taskSlug, 't');
  server.close();
});

test('GET /api/me/submissions: limit/offset', async () => {
  const { db, app, userId, cookie } = await setup();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  for (let i = 0; i < 5; i++) {
    insertSubmission(db, { taskId: t.id, userId, originalFilename: String(i), sizeBytes: 1, sha256: 'x', path: '/x' });
  }
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/submissions?limit=2&offset=1`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(r.submissions.length, 2);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Endpoints в `me.js`**

```js
import { listMembershipsForUser } from '../db/competitionMembersRepo.js';
import { getCompetition } from '../db/competitionsRepo.js';
import { listAllSubmissionsForUser } from '../db/submissionsRepo.js';
import { buildNativeLeaderboard } from '../scoring/nativeLeaderboard.js';

router.get('/competitions', requireAuth, (req, res) => {
  const memberships = listMembershipsForUser(db, req.user.id);
  const out = [];
  for (const m of memberships) {
    const c = getCompetition(db, m.competitionSlug);
    if (!c || c.deletedAt) continue;
    let totalPoints = null, place = null;
    if (c.type === 'native') {
      const lb = buildNativeLeaderboard(db, c.slug, 'public');
      const row = lb.overall.find((e) => e.participantKey === `user:${req.user.id}`);
      if (row) { totalPoints = row.totalPoints; place = row.place; }
    }
    out.push({
      slug: c.slug,
      title: c.title,
      type: c.type,
      visibility: c.visibility,
      joinedAt: m.joinedAt,
      totalPoints,
      place,
    });
  }
  res.json({ competitions: out });
});

router.get('/submissions', requireAuth, (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const offset = Number(req.query.offset) || 0;
  const list = listAllSubmissionsForUser(db, req.user.id, { limit, offset });
  res.json({ submissions: list });
});
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/me.js backend/tests/sp4_me.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): GET /api/me/competitions + /api/me/submissions"
```

---

## Phase 3 — Membership endpoints

### Task 3.1: Join / Leave / Membership

**Files:**
- Create: `backend/src/routes/membership.js`
- Modify: `backend/src/app.js`
- Create: `backend/tests/sp4_membership.test.js`

- [ ] **Step 1: Тесты**

`backend/tests/sp4_membership.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
async function setup() {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  return { db, app: createApp({ db }), userId: u.id, cookie: `${SESSION_COOKIE}=${sess.id}` };
}
async function start(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }

test('POST /api/competitions/c/join: первый раз → joined; повторно → alreadyMember', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r1 = await fetch(`http://127.0.0.1:${port}/api/competitions/c/join`, { method: 'POST', headers: { cookie } }).then((x) => x.json());
  assert.equal(r1.alreadyMember, false);
  const r2 = await fetch(`http://127.0.0.1:${port}/api/competitions/c/join`, { method: 'POST', headers: { cookie } }).then((x) => x.json());
  assert.equal(r2.alreadyMember, true);
  server.close();
});

test('DELETE /api/competitions/c/members/me: удаляет; повторный → 200 (idempotent)', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/competitions/c/join`, { method: 'POST', headers: { cookie } });
  const r1 = await fetch(`http://127.0.0.1:${port}/api/competitions/c/members/me`, { method: 'DELETE', headers: { cookie } });
  assert.equal(r1.status, 200);
  const r2 = await fetch(`http://127.0.0.1:${port}/api/competitions/c/members/me`, { method: 'DELETE', headers: { cookie } });
  assert.equal(r2.status, 200);
  server.close();
});

test('GET /api/competitions/c/membership: для анона isMember=false без 401', async () => {
  const { app } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/membership`).then((x) => x.json());
  assert.equal(r.isMember, false);
  server.close();
});

test('GET /api/competitions/c/membership: для члена isMember=true + joinedAt', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/competitions/c/join`, { method: 'POST', headers: { cookie } });
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/membership`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(r.isMember, true);
  assert.ok(r.joinedAt);
  server.close();
});

test('POST /join: 404 несуществующего соревнования', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/nope/join`, { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 404);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/routes/membership.js`:
```js
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getCompetition } from '../db/competitionsRepo.js';
import {
  joinCompetition,
  leaveCompetition,
  isMember,
  getMembership,
} from '../db/competitionMembersRepo.js';

export function createMembershipRouter({ db }) {
  const router = Router({ mergeParams: true });

  router.post('/join', requireAuth, (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt) return res.status(404).json({ error: 'competition not found' });
    const result = joinCompetition(db, c.slug, req.user.id);
    res.json({ joined: true, alreadyMember: result.alreadyMember });
  });

  router.delete('/members/me', requireAuth, (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt) return res.status(404).json({ error: 'competition not found' });
    leaveCompetition(db, c.slug, req.user.id);
    res.json({ left: true });
  });

  router.get('/membership', (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt) return res.status(404).json({ error: 'competition not found' });
    if (!req.user) return res.json({ isMember: false, joinedAt: null });
    const m = getMembership(db, c.slug, req.user.id);
    res.json({ isMember: !!m, joinedAt: m?.joinedAt || null });
  });

  return router;
}
```

В `app.js`:
```js
import { createMembershipRouter } from './routes/membership.js';
app.use('/api/competitions/:competitionSlug', createMembershipRouter({ db }));
```

> Замечание: убедись что этот mount не конфликтует с существующими `/api/competitions/:competitionSlug/...` ручками. Express матчит по порядку — проверь что mount идёт ПЕРЕД более общими handler'ами. Безопасный порядок: membership router монтируется в самом конце `/api/competitions/:competitionSlug` mount-ов.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/membership.js backend/src/app.js backend/tests/sp4_membership.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): membership endpoints (join + leave + membership status)"
```

---

## Phase 4 — Selected submissions API + private LB fallback

### Task 4.1: PUT submissions/<id>/select

**Files:**
- Modify: `backend/src/routes/submissionsPublic.js`
- Modify: `backend/tests/sp4_selected.test.js`

- [ ] **Step 1: Тесты integration**

```js
import { createApp } from '../src/app.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

async function startApp(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }

test('PUT /submissions/:id/select: помечает', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const subId = makeScoredSub(db, t.id, u.id, 70);
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const cookie = `${SESSION_COOKIE}=${sess.id}`;
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${subId}/select`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selected: true }),
  });
  assert.equal(r.status, 200);
  assert.equal(getSubmission(db, subId).selected, 1);
  server.close();
});

test('PUT /select: третий select при 2 уже выбранных → 400', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const a = makeScoredSub(db, t.id, u.id, 70);
  const b = makeScoredSub(db, t.id, u.id, 80);
  const c = makeScoredSub(db, t.id, u.id, 90);
  setSubmissionSelected(db, a, true);
  setSubmissionSelected(db, b, true);
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const cookie = `${SESSION_COOKIE}=${sess.id}`;
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${c}/select`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selected: true }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('PUT /select: чужой submission → 404', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u1 = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const u2 = createUser(db, { email: 'b@b.b', passwordHash: await hashPassword('p'), displayName: 'B' });
  const subId = makeScoredSub(db, t.id, u1.id, 70);
  const sess = createSession(db, { userId: u2.id, ttlMs: 60_000 });
  const cookie = `${SESSION_COOKIE}=${sess.id}`;
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${subId}/select`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selected: true }),
  });
  assert.equal(r.status, 404);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Endpoint в `submissionsPublic.js`**

В существующий router добавить:
```js
import { setSubmissionSelected, countSelectedForUserTask } from '../db/submissionsRepo.js';

router.put('/:id/select', requireAuth, (req, res) => {
  const sub = getSubmission(db, Number(req.params.id));
  if (!sub) return res.status(404).json({ error: 'not found' });
  if (sub.userId !== req.user.id) return res.status(404).json({ error: 'not found' });
  if (sub.status !== 'scored') return res.status(400).json({ error: 'submission not scored yet' });
  const selected = req.body?.selected !== false;
  if (selected) {
    const count = countSelectedForUserTask(db, req.user.id, sub.taskId);
    if (sub.selected === 0 && count >= 2) {
      return res.status(400).json({ error: 'max 2 selected per task; unselect another first' });
    }
  }
  setSubmissionSelected(db, sub.id, selected);
  res.json({ submission: { id: sub.id, selected: selected ? 1 : 0 } });
});
```

> Замечание: маршрут `/:id/select` может конфликтовать с существующими в SP-3 (`/:id/rescore` etc.). Проверь порядок — `/:id/select` должен идти ПЕРЕД более общим catch-all'ом если он есть. В SP-3 plan'е `/me`-маршрут был перед `/:id`, оставляем тот же паттерн.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/routes/submissionsPublic.js backend/tests/sp4_selected.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(api): PUT /submissions/:id/select with max-2 rule"
```

---

### Task 4.2: nativeLeaderboard.private — selected fallback

**Files:**
- Modify: `backend/src/scoring/nativeLeaderboard.js`
- Modify: `backend/tests/sp4_selected.test.js`

- [ ] **Step 1: Тесты**

```js
import { buildNativeLeaderboard } from '../src/scoring/nativeLeaderboard.js';

test('private LB: selected фильтр — берёт best из selected, не из всех', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T',
    baselineScorePrivate: 0, authorScorePrivate: 1 });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  // три scored submission с private points = 70, 80, 90
  function scoredPriv(points) {
    const s = insertSubmission(db, { taskId: t.id, userId: u.id, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: '/x' });
    pickAndMarkScoring(db);
    markScored(db, s.id, {
      rawScorePublic: 0.5, pointsPublic: 50,
      rawScorePrivate: points / 100, pointsPrivate: points,
      log: '', durationMs: 1,
    });
    return s.id;
  }
  const a = scoredPriv(70);
  const b = scoredPriv(80);
  const c = scoredPriv(90);
  // Помечаем 70 и 80 как selected (90 НЕ выбран)
  setSubmissionSelected(db, a, true);
  setSubmissionSelected(db, b, true);
  const lb = buildNativeLeaderboard(db, 'c', 'private');
  // Best из selected = 80, не 90
  const row = lb.overall.find((e) => e.participantKey === `user:${u.id}`);
  assert.equal(row.totalPoints, 80);
});

test('private LB: ни одного selected → fallback на overall best (90)', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T',
    baselineScorePrivate: 0, authorScorePrivate: 1 });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  function scoredPriv(points) {
    const s = insertSubmission(db, { taskId: t.id, userId: u.id, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: '/x' });
    pickAndMarkScoring(db);
    markScored(db, s.id, { rawScorePublic: 0.5, pointsPublic: 50, rawScorePrivate: points/100, pointsPrivate: points, log: '', durationMs: 1 });
  }
  scoredPriv(70); scoredPriv(80); scoredPriv(90);
  const lb = buildNativeLeaderboard(db, 'c', 'private');
  const row = lb.overall.find((e) => e.participantKey === `user:${u.id}`);
  assert.equal(row.totalPoints, 90);
});

test('public LB: selected не влияет (всегда best)', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const a = makeScoredSub(db, t.id, u.id, 70);
  const b = makeScoredSub(db, t.id, u.id, 90);
  setSubmissionSelected(db, a, true);  // отметили только худший
  const lb = buildNativeLeaderboard(db, 'c', 'public');
  const row = lb.overall.find((e) => e.participantKey === `user:${u.id}`);
  assert.equal(row.totalPoints, 90); // всё равно 90
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Расширить `nativeLeaderboard.js`**

В функции `buildNativeLeaderboard`, для `variant === 'private'` заменить query на 2-частный с COALESCE fallback:

```js
const pointsCol = variant === 'private' ? 'points_private' : 'points_public';
const rawCol = variant === 'private' ? 'raw_score_private' : 'raw_score_public';

let rows;
if (variant === 'private') {
  // Selected best per user-task; если selected пусто — fallback на overall best
  rows = db.prepare(
    `WITH selected_best AS (
       SELECT s.task_id, s.user_id, s.points_private AS points, s.raw_score_private AS raw_score, s.created_at,
              ROW_NUMBER() OVER (PARTITION BY s.task_id, s.user_id ORDER BY s.points_private DESC, s.id ASC) AS rn
       FROM submissions s
       WHERE s.status='scored' AND s.points_private IS NOT NULL AND s.selected = 1
         AND s.task_id IN (${placeholders})
     ),
     overall_best AS (
       SELECT s.task_id, s.user_id, s.points_private AS points, s.raw_score_private AS raw_score, s.created_at,
              ROW_NUMBER() OVER (PARTITION BY s.task_id, s.user_id ORDER BY s.points_private DESC, s.id ASC) AS rn
       FROM submissions s
       WHERE s.status='scored' AND s.points_private IS NOT NULL
         AND s.task_id IN (${placeholders})
     ),
     sb AS (SELECT * FROM selected_best WHERE rn = 1),
     ob AS (SELECT * FROM overall_best WHERE rn = 1)
     SELECT
       COALESCE(sb.task_id, ob.task_id) AS taskId,
       COALESCE(sb.user_id, ob.user_id) AS userId,
       COALESCE(sb.points, ob.points) AS points,
       COALESCE(sb.raw_score, ob.raw_score) AS rawScore,
       COALESCE(sb.created_at, ob.created_at) AS createdAt,
       u.display_name AS nickname,
       u.kaggle_id AS kaggleId
     FROM sb FULL OUTER JOIN ob
       ON sb.task_id = ob.task_id AND sb.user_id = ob.user_id
     JOIN users u ON u.id = COALESCE(sb.user_id, ob.user_id)
     ORDER BY COALESCE(sb.points, ob.points) DESC`
  ).all(...taskIds, ...taskIds);
} else {
  // public — старый query из SP-3
  rows = db.prepare(
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
     ORDER BY b.${pointsCol} DESC`
  ).all(...taskIds);
}
```

> Замечание: SQLite `FULL OUTER JOIN` поддерживается с 3.39 (2022-09). better-sqlite3 ^11 идёт с SQLite 3.45+. Если вдруг выпадет older SQLite, fallback — UNION двух LEFT JOIN-ов; импл-план не делает этой ветки.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/scoring/nativeLeaderboard.js backend/tests/sp4_selected.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): private LB — selected best with fallback to overall"
```

---

## Phase 5 — Native deltas через snapshot cache

### Task 5.1: snapshotCache + annotateDeltas

**Files:**
- Create: `backend/src/scoring/snapshotCache.js`
- Create: `backend/tests/sp4_snapshots.test.js`

- [ ] **Step 1: Тесты**

`backend/tests/sp4_snapshots.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSnapshotCache } from '../src/scoring/snapshotCache.js';

test('snapshotCache: первая запись — deltas null', () => {
  const cache = makeSnapshotCache();
  const fresh = {
    overall: [{ participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } }],
    byTask: { t: { entries: [{ participantKey: 'user:1', points: 100 }] } },
  };
  const annotated = cache.annotate('c', fresh);
  assert.equal(annotated.overall[0].previousTotalPoints, null);
  assert.equal(annotated.overall[0].tasks.t.previousPoints, null);
  assert.equal(annotated.byTask.t.entries[0].previousPoints, null);
});

test('snapshotCache: после второй записи deltas заполнены', () => {
  const cache = makeSnapshotCache();
  cache.annotate('c', {
    overall: [{ participantKey: 'user:1', totalPoints: 80, tasks: { t: { points: 80 } } }],
    byTask: { t: { entries: [{ participantKey: 'user:1', points: 80 }] } },
  });
  const second = cache.annotate('c', {
    overall: [{ participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } }],
    byTask: { t: { entries: [{ participantKey: 'user:1', points: 100 }] } },
  });
  assert.equal(second.overall[0].previousTotalPoints, 80);
  assert.equal(second.overall[0].tasks.t.previousPoints, 80);
  assert.equal(second.byTask.t.entries[0].previousPoints, 80);
});

test('snapshotCache: новый юзер во втором snapshot — previousPoints=null', () => {
  const cache = makeSnapshotCache();
  cache.annotate('c', {
    overall: [{ participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } }],
    byTask: { t: { entries: [{ participantKey: 'user:1', points: 100 }] } },
  });
  const second = cache.annotate('c', {
    overall: [
      { participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } },
      { participantKey: 'user:2', totalPoints: 90, tasks: { t: { points: 90 } } },
    ],
    byTask: { t: { entries: [
      { participantKey: 'user:1', points: 100 },
      { participantKey: 'user:2', points: 90 },
    ] } },
  });
  const newUser = second.overall.find((e) => e.participantKey === 'user:2');
  assert.equal(newUser.previousTotalPoints, null);
  const newUserTaskEntry = second.byTask.t.entries.find((e) => e.participantKey === 'user:2');
  assert.equal(newUserTaskEntry.previousPoints, null);
});

test('snapshotCache: per-competition isolation', () => {
  const cache = makeSnapshotCache();
  cache.annotate('c1', { overall: [{ participantKey: 'user:1', totalPoints: 50, tasks: {} }], byTask: {} });
  cache.annotate('c2', { overall: [{ participantKey: 'user:1', totalPoints: 70, tasks: {} }], byTask: {} });
  const second = cache.annotate('c1', { overall: [{ participantKey: 'user:1', totalPoints: 60, tasks: {} }], byTask: {} });
  // previous из c1, не из c2
  assert.equal(second.overall[0].previousTotalPoints, 50);
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/scoring/snapshotCache.js`:
```js
export function makeSnapshotCache() {
  const snapshots = new Map(); // slug → { overall, byTask, capturedAt }

  function annotate(slug, fresh) {
    const previous = snapshots.get(slug) || null;
    const annotated = annotateWithPrevious(fresh, previous);
    snapshots.set(slug, structuredClone(fresh)); // храним «сырое» состояние без deltas
    return annotated;
  }

  function get(slug) {
    return snapshots.get(slug) || null;
  }

  function clear(slug) {
    if (slug) snapshots.delete(slug);
    else snapshots.clear();
  }

  return { annotate, get, clear };
}

function annotateWithPrevious(fresh, previous) {
  // глубокий клон чтобы не мутировать вход
  const out = structuredClone(fresh);
  const prevTotalByKey = new Map();
  const prevTaskPointsByKey = new Map(); // `${taskSlug}|${participantKey}` → points

  if (previous) {
    for (const e of previous.overall || []) {
      if (e.participantKey) prevTotalByKey.set(e.participantKey, e.totalPoints);
    }
    for (const slug of Object.keys(previous.byTask || {})) {
      for (const e of previous.byTask[slug]?.entries || []) {
        if (e.participantKey) prevTaskPointsByKey.set(`${slug}|${e.participantKey}`, e.points);
      }
    }
  }

  for (const e of out.overall || []) {
    e.previousTotalPoints = prevTotalByKey.has(e.participantKey)
      ? prevTotalByKey.get(e.participantKey) : null;
    if (e.tasks) {
      for (const slug of Object.keys(e.tasks)) {
        const prev = prevTaskPointsByKey.get(`${slug}|${e.participantKey}`);
        e.tasks[slug].previousPoints = prev !== undefined ? prev : null;
      }
    }
  }
  for (const slug of Object.keys(out.byTask || {})) {
    for (const e of out.byTask[slug]?.entries || []) {
      const prev = prevTaskPointsByKey.get(`${slug}|${e.participantKey}`);
      e.previousPoints = prev !== undefined ? prev : null;
    }
  }
  return out;
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/scoring/snapshotCache.js backend/tests/sp4_snapshots.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): snapshotCache for native deltas"
```

---

### Task 5.2: Worker hook onScored + leaderboard endpoint reads from snapshot

**Files:**
- Modify: `backend/src/scoring/worker.js`
- Modify: `backend/src/app.js`
- Modify: `backend/tests/sp4_snapshots.test.js`

- [ ] **Step 1: Тест integration**

```js
test('worker → leaderboard endpoint: deltas заполнены после второго scored', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T',
    baselineScorePublic: 0, authorScorePublic: 1 });
  // grader-fixture путь
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const FX = path.join(__dirname, 'fixtures/grader');
  // Этот тест требует чтобы fixtures/grader/score-anchored.py существовал (из SP-3 plan)
  const fs = await import('node:fs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp4-snap-'));
  const gtFile = path.join(dir, 'gt.csv');
  fs.writeFileSync(gtFile, 'truth');
  const updateNativeTask = (await import('../src/db/nativeTasksRepo.js')).updateNativeTask;
  updateNativeTask(db, 'c', 't', { graderPath: path.join(FX, 'score-anchored.py'), groundTruthPath: gtFile });
  const u1 = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'Alice' });
  const u2 = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'Bob' });
  const subFile1 = path.join(dir, 'sub1.csv');
  const subFile2 = path.join(dir, 'sub2.csv');
  fs.writeFileSync(subFile1, '0.5\n');
  fs.writeFileSync(subFile2, '0.7\n');
  insertSubmission(db, { taskId: t.id, userId: u1.id, originalFilename: 'sub1', sizeBytes: 1, sha256: 'x', path: subFile1 });
  // воркер tick 1 — Alice = 50
  const { tick } = await import('../src/scoring/worker.js');
  await tick(db, { timeoutMs: 5000 });

  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  // первый запрос /leaderboard — previous = null (первый snapshot)
  const r1 = await fetch(`http://127.0.0.1:${port}/api/competitions/c/leaderboard`).then((x) => x.json());
  assert.equal(r1.overall[0].previousTotalPoints, null);

  // 2-й сабмит Боба
  insertSubmission(db, { taskId: t.id, userId: u2.id, originalFilename: 'sub2', sizeBytes: 1, sha256: 'y', path: subFile2 });
  await tick(db, { timeoutMs: 5000 });

  const r2 = await fetch(`http://127.0.0.1:${port}/api/competitions/c/leaderboard`).then((x) => x.json());
  // Alice — 50 (без изменений), Bob — 70 (новенький)
  const alice = r2.overall.find((e) => e.nickname === 'Alice');
  const bob = r2.overall.find((e) => e.nickname === 'Bob');
  assert.equal(alice.previousTotalPoints, 50); // Alice была в предыдущем snapshot с 50
  assert.equal(bob.previousTotalPoints, null); // Bob новый

  fs.rmSync(dir, { recursive: true, force: true });
  server.close();
});
```

- [ ] **Step 2: FAIL** (worker не вызывает onScored, leaderboard не использует snapshot)

- [ ] **Step 3: Подключить snapshot к worker'у**

В `worker.js` после `markScored`:
```js
import { getNativeTaskById } from '../db/nativeTasksRepo.js';
// ...

let onScoredCallback = null;
export function setOnScoredCallback(cb) { onScoredCallback = cb; }

// внутри tick, после `markScored(...)` — для public-only пути:
if (onScoredCallback) {
  try { onScoredCallback(task.competitionSlug); } catch (e) { console.error('[worker] onScored failed', e); }
}
```

(Применить в обоих ветках: public-only success и public+private success.)

- [ ] **Step 4: Подключить snapshot к leaderboard endpoint'у**

В `app.js`:
```js
import { makeSnapshotCache } from './scoring/snapshotCache.js';
import { setOnScoredCallback } from './scoring/worker.js';

const snapshotCache = makeSnapshotCache();

// при создании app:
setOnScoredCallback((slug) => {
  const fresh = buildNativeLeaderboard(db, slug, 'public');
  snapshotCache.annotate(slug, fresh);
});

// в leaderboard endpoint для native ветки:
if (meta.type === 'native') {
  const pubFresh = buildNativeLeaderboard(db, meta.slug, 'public');
  const pub = snapshotCache.annotate(meta.slug, pubFresh);
  const priv = buildNativeLeaderboard(db, meta.slug, 'private');
  // privateTaskSlugs: задачи где есть точки в private
  const privateTaskSlugs = Object.keys(priv.byTask).filter((slug) => priv.byTask[slug].entries.length > 0);
  res.json({
    updatedAt: new Date().toISOString(),
    tasks: pub.tasks,
    overall: pub.overall,
    byTask: pub.byTask,
    privateOverall: priv.overall,
    privateByTask: priv.byTask,
    privateTaskSlugs,
    oursOverall: pub.overall,
    oursByTask: pub.byTask,
    oursPrivateOverall: priv.overall,
    oursPrivateByTask: priv.byTask,
    errors: [],
  });
  return;
}
```

> Замечание: вызов `snapshotCache.annotate` на каждом `/leaderboard` request'e обновляет снэпшот при каждом запросе фронта. Это даёт полные deltas против ПРЕДЫДУЩЕГО запроса фронта, что не совсем то что хочется (deltas против предыдущего scored сабмита). Правильнее: snapshot обновляется ТОЛЬКО в worker'е через `onScoredCallback`, а endpoint просто читает annotated данные без перезаписи. Делай так:

```js
// при создании app — onScored обновляет snapshot:
setOnScoredCallback((slug) => {
  const fresh = buildNativeLeaderboard(db, slug, 'public');
  snapshotCache.annotate(slug, fresh);
});

// в endpoint — НЕ зовём annotate, а используем последний annotated snapshot:
if (meta.type === 'native') {
  let pub = snapshotCache.get(meta.slug);
  if (!pub) {
    // первый запрос после рестарта — построим on-demand, без deltas
    const fresh = buildNativeLeaderboard(db, meta.slug, 'public');
    pub = snapshotCache.annotate(meta.slug, fresh);
  }
  // ...
}
```

И исправь тест выше: после первого worker tick'a snapshot уже annotated → second tick sees previous → r2 показывает deltas. Первый tick — previous=null. r1 после первого tick'a — previousTotalPoints=null. r2 после второго tick'a — previousTotalPoints=50 для Alice. Тест уже это проверяет.

- [ ] **Step 5: PASS**

- [ ] **Step 6: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add backend/src/scoring/worker.js backend/src/app.js backend/tests/sp4_snapshots.test.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(scoring): native deltas — onScored hook + snapshot in leaderboard endpoint"
```

---

## Phase 6 — Frontend кабинет

### Task 6.1: api.js helpers

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Добавить helpers**

В конец `api.js`:
```js
export const meApi = {
  get: () => request('/me'),
  update: (patch) => request('/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  changePassword: (body) => request('/me/password', { method: 'POST', body: JSON.stringify(body) }),
  competitions: () => request('/me/competitions'),
  submissions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/me/submissions${qs ? `?${qs}` : ''}`);
  },
};

export const membership = {
  get: (slug) => request(`/competitions/${slug}/membership`),
  join: (slug) => request(`/competitions/${slug}/join`, { method: 'POST' }),
  leave: (slug) => request(`/competitions/${slug}/members/me`, { method: 'DELETE' }),
};

submissions.toggleSelected = (compSlug, taskSlug, id, selected) =>
  request(`/competitions/${compSlug}/native-tasks/${taskSlug}/submissions/${id}/select`,
    { method: 'PUT', body: JSON.stringify({ selected }) });
```

- [ ] **Step 2: Build**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/api.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/api): meApi + membership + submissions.toggleSelected"
```

---

### Task 6.2: ProfileSection + PasswordSection

**Files:**
- Create: `frontend/src/me/ProfileSection.jsx`
- Create: `frontend/src/me/PasswordSection.jsx`

- [ ] **Step 1: ProfileSection**

```jsx
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { meApi } from '../api.js';

export default function ProfileSection() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({
    email: user?.email || '',
    displayName: user?.displayName || '',
    kaggleId: user?.kaggleId || '',
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function save(e) {
    e.preventDefault();
    setBusy(true); setMsg(''); setErr('');
    try {
      await meApi.update({
        email: form.email,
        displayName: form.displayName,
        kaggleId: form.kaggleId || null,
      });
      await refresh();
      setMsg('Сохранено');
    } catch (e) { setErr(e.message || 'failed'); }
    finally { setBusy(false); }
  }

  if (!user) return null;
  return (
    <section className="profile-section">
      <h2>Профиль</h2>
      <form onSubmit={save}>
        <label>Email <input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>Имя <input value={form.displayName} onChange={set('displayName')} required maxLength={80} /></label>
        <label>Kaggle ID <input value={form.kaggleId} onChange={set('kaggleId')} placeholder="myname" /></label>
        <button disabled={busy}>{busy ? '…' : 'Сохранить'}</button>
        {msg && <div className="success">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </form>
    </section>
  );
}
```

- [ ] **Step 2: PasswordSection**

```jsx
import { useState } from 'react';
import { meApi } from '../api.js';

export default function PasswordSection() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    setMsg(''); setErr('');
    if (form.next !== form.confirm) { setErr('Пароли не совпадают'); return; }
    if (form.next.length < 8) { setErr('Новый пароль ≥ 8 символов'); return; }
    setBusy(true);
    try {
      await meApi.changePassword({ currentPassword: form.current, newPassword: form.next });
      setForm({ current: '', next: '', confirm: '' });
      setMsg('Пароль изменён');
    } catch (e) { setErr(e.message || 'failed'); }
    finally { setBusy(false); }
  }

  return (
    <section className="password-section">
      <h2>Сменить пароль</h2>
      <form onSubmit={submit}>
        <label>Текущий <input type="password" value={form.current} onChange={set('current')} required /></label>
        <label>Новый (≥ 8) <input type="password" value={form.next} onChange={set('next')} required minLength={8} /></label>
        <label>Подтверждение <input type="password" value={form.confirm} onChange={set('confirm')} required /></label>
        <button disabled={busy}>{busy ? '…' : 'Сменить'}</button>
        {msg && <div className="success">{msg}</div>}
        {err && <div className="error">{err}</div>}
      </form>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/me/ProfileSection.jsx frontend/src/me/PasswordSection.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/me): ProfileSection + PasswordSection components"
```

---

### Task 6.3: MyCompetitions + MySubmissionsCabinet

**Files:**
- Create: `frontend/src/me/MyCompetitions.jsx`
- Create: `frontend/src/me/MySubmissionsCabinet.jsx`

- [ ] **Step 1: MyCompetitions**

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { meApi, membership } from '../api.js';

export default function MyCompetitions() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  async function load() {
    try { const r = await meApi.competitions(); setItems(r.competitions); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function leave(slug) {
    if (!confirm(`Выйти из соревнования «${slug}»?`)) return;
    await membership.leave(slug);
    load();
  }

  if (error) return <div className="error">{error}</div>;
  if (items.length === 0) return <p className="dim">Вы не в одном соревновании</p>;

  return (
    <section>
      <h2>Мои соревнования</h2>
      <table>
        <thead><tr><th>Соревнование</th><th>Тип</th><th>Очки</th><th>Место</th><th>С</th><th></th></tr></thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.slug}>
              <td><Link to={`/competitions/${c.slug}`}>{c.title}</Link></td>
              <td>{c.type}</td>
              <td>{c.totalPoints != null ? c.totalPoints.toFixed(2) : '—'}</td>
              <td>{c.place ?? '—'}</td>
              <td>{new Date(c.joinedAt).toLocaleDateString()}</td>
              <td><button onClick={() => leave(c.slug)}>Выйти</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: MySubmissionsCabinet**

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { meApi } from '../api.js';

export default function MySubmissionsCabinet() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    meApi.submissions({ limit: 100 }).then((r) => setItems(r.submissions)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (items.length === 0) return <p className="dim">Сабмитов пока нет</p>;

  return (
    <section>
      <h2>Мои сабмиты</h2>
      <table className="submissions-table">
        <thead>
          <tr><th>Когда</th><th>Соревнование</th><th>Задача</th><th>Файл</th><th>Статус</th><th>Public</th><th>Private</th><th>Selected</th></tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>{new Date(s.createdAt).toLocaleString()}</td>
              <td><Link to={`/competitions/${s.competitionSlug}`}>{s.competitionSlug}</Link></td>
              <td><Link to={`/competitions/${s.competitionSlug}/native-tasks/${s.taskSlug}`}>{s.taskSlug}</Link></td>
              <td>{s.originalFilename}</td>
              <td>{s.status}</td>
              <td>{s.pointsPublic != null ? s.pointsPublic.toFixed(2) : '—'}</td>
              <td>{s.pointsPrivate != null ? s.pointsPrivate.toFixed(2) : '—'}</td>
              <td>{s.selected ? '★' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/me/MyCompetitions.jsx frontend/src/me/MySubmissionsCabinet.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe/me): MyCompetitions + MySubmissionsCabinet components"
```

---

### Task 6.4: MePage + routes + UserMenu link

**Files:**
- Create: `frontend/src/me/MePage.jsx`
- Modify: `frontend/src/App.jsx`, `frontend/src/UserMenu.jsx`

- [ ] **Step 1: MePage**

```jsx
import { Link } from 'react-router-dom';
import ProfileSection from './ProfileSection.jsx';
import PasswordSection from './PasswordSection.jsx';
import MyCompetitions from './MyCompetitions.jsx';
import MySubmissionsCabinet from './MySubmissionsCabinet.jsx';

export default function MePage() {
  return (
    <div className="me-page">
      <h1>Личный кабинет</h1>
      <nav className="me-nav">
        <Link to="/me">Профиль</Link>
        <Link to="/me/competitions">Мои соревнования</Link>
        <Link to="/me/submissions">Мои сабмиты</Link>
      </nav>
      <ProfileSection />
      <PasswordSection />
    </div>
  );
}

export function MeCompetitionsPage() { return <div className="me-page"><h1>Мои соревнования</h1><MyCompetitions /></div>; }
export function MeSubmissionsPage() { return <div className="me-page"><h1>Мои сабмиты</h1><MySubmissionsCabinet /></div>; }
```

- [ ] **Step 2: Routes в `App.jsx`**

```jsx
import MePage, { MeCompetitionsPage, MeSubmissionsPage } from './me/MePage.jsx';
// ...
<Route path="/me" element={<MePage />} />
<Route path="/me/competitions" element={<MeCompetitionsPage />} />
<Route path="/me/submissions" element={<MeSubmissionsPage />} />
```

- [ ] **Step 3: UserMenu link**

В `UserMenu.jsx` для авторизованного:
```jsx
<Link to="/me">Личный кабинет</Link>
```

(добавить рядом с другими ссылками юзера, до «Выйти»).

- [ ] **Step 4: Smoke**

```bash
cd frontend && npm run dev
```
Зарегиться → шапка показывает «Личный кабинет» → клик → видишь профиль с заполненными полями → меняешь displayName → save → перезагружай → видишь новое имя в шапке.

- [ ] **Step 5: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/me/MePage.jsx frontend/src/App.jsx frontend/src/UserMenu.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe): MePage + routes + UserMenu link"
```

---

## Phase 7 — Join button + selected toggle

### Task 7.1: JoinButton component

**Files:**
- Create: `frontend/src/competition/JoinButton.jsx`
- Modify: `frontend/src/native/NativeTaskPage.jsx` (или CompetitionPage если есть)

- [ ] **Step 1: Реализация**

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { membership } from '../api.js';

export default function JoinButton({ competitionSlug }) {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, isMember: false });

  async function load() {
    try {
      const r = await membership.get(competitionSlug);
      setState({ loading: false, isMember: r.isMember });
    } catch (e) { setState({ loading: false, isMember: false }); }
  }
  useEffect(() => { load(); }, [competitionSlug]);

  if (state.loading) return null;
  if (!user) return <Link to="/login" className="join-link">Войти чтобы участвовать</Link>;
  if (state.isMember) return <span className="join-status">Вы участник</span>;
  return (
    <button className="join-button" onClick={async () => {
      await membership.join(competitionSlug);
      load();
    }}>Участвовать</button>
  );
}
```

- [ ] **Step 2: Подключить на странице соревнования**

В `NativeTaskPage.jsx` (рядом с заголовком задачи) или на CompetitionPage (если есть):
```jsx
import JoinButton from '../competition/JoinButton.jsx';
// ...
<JoinButton competitionSlug={competitionSlug} />
```

> Замечание: в SP-3 сабмит auto-join'ит, поэтому JoinButton после первого сабмита покажет «Вы участник». Это ОК — UX consistency.

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/competition/JoinButton.jsx frontend/src/native/NativeTaskPage.jsx
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe): JoinButton component"
```

---

### Task 7.2: Selected toggle в MySubmissions (на странице задачи)

**Files:**
- Modify: `frontend/src/native/MySubmissions.jsx`

- [ ] **Step 1: Добавить колонку**

```jsx
import { submissions } from '../api.js';

// в состояние таблицы добавить столбец Selected:
<thead>
  <tr>
    <th>Когда</th><th>Файл</th><th>Статус</th><th>Public</th><th>Private</th><th>Raw</th><th>Selected</th>
  </tr>
</thead>
<tbody>
  {list.map((s) => (
    <tr key={s.id}>
      ...{/* существующие колонки */}
      <td>
        {s.status === 'scored' && (
          <input
            type="checkbox"
            checked={!!s.selected}
            onChange={async (e) => {
              try {
                await submissions.toggleSelected(competitionSlug, taskSlug, s.id, e.target.checked);
                refetch();
              } catch (err) { alert(err.message); }
            }}
            disabled={!s.selected && countSelected(list) >= 2}
          />
        )}
      </td>
    </tr>
  ))}
</tbody>

function countSelected(list) {
  return list.filter((s) => s.selected).length;
}
```

> Замечание: дополнительно в `s.selected` нужно убедиться — `publicSubmissionForUser` в SP-3 routes/submissionsPublic.js возвращает поле `selected`? Проверь и при необходимости добавь:
> ```js
> // в publicSubmissionForUser:
> return { ...out, selected: s.selected };
> ```
> (или включи selected в основной object).

Если `submissions.listMine` не возвращает `selected` — фронт-toggle не сможет показать состояние правильно.

- [ ] **Step 2: Smoke**

Логин → задача → сделать 3 сабмита → дождаться scored → пометить 2 selected → 3-я галочка disabled. Снять одну → можно ставить.

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add frontend/src/native/MySubmissions.jsx backend/src/routes/submissionsPublic.js
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "feat(fe): selected checkbox in MySubmissions (max 2)"
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

- [ ] **Step 2: Native flow**

В UI: создать как админ native соревнование `final-test` → задачу `t1` с `score-anchored.py` (использует первое число из sub.csv) + якорями baseline=0, author=1 → загрузить ground-truth-public + ground-truth-private.

- [ ] **Step 3: Зарегистрировать participant**

В incognito: register → перейти на `/competitions/final-test` → нажать «Участвовать» → перейти на `t1`.

- [ ] **Step 4: Сдать 3 сабмита**

С содержимым `0.5\n`, `0.7\n`, `0.9\n` — получить points 50, 70, 90.

- [ ] **Step 5: Selected**

Помечаешь сабмиты с 50 и 70 как selected. 3-й (90) — galочка disabled. Поставить 90 → 400 ошибка / disabled.

- [ ] **Step 6: Лидерборд (public + private)**

`/competitions/final-test/leaderboard` — public показывает 90 (best). Private — 70 (best из selected).

- [ ] **Step 7: Deltas**

Сделать ещё один сабмит с 0.95 → дождаться scored → лидерборд должен показывать зелёную стрелку у participant'a (90 → 95).

- [ ] **Step 8: Кабинет**

`/me` → видишь профиль + меняешь displayName → шапка обновляется.
`/me/competitions` → видишь final-test, place=1, totalPoints≈95.
`/me/submissions` → видишь все 4 сабмита со statuses + selected.
«Выйти из соревнования» → исчезает из списка.

- [ ] **Step 9: Existing kaggle leaderboard `neoai-2026` не сломан**

```bash
curl -s http://localhost:3001/api/competitions/neoai-2026/leaderboard | jq '.tasks | length'
```
Expected: то же значение что и до SP-4.

- [ ] **Step 10: Все тесты зелёные**

```bash
cd backend && npm test
```

- [ ] **Step 11: Smoke commit (нечего коммитить)**

---

### Task 8.2: README + ROUTES.md

**Files:**
- Modify: `new_lb/README.md`, `new_lb/ROUTES.md`

- [ ] **Step 1: README**

В секцию «Архитектура / Что внутри» дописать:

> **Личный кабинет** (`/me`): профиль (email, displayName, kaggleId), смена пароля, список своих соревнований с местом, плоская лента всех сабмитов.
>
> **Selected submissions**: участник может пометить до 2 сабмитов на задачу как final — на private-LB учитываются именно они (если ничего не выбрал — fallback на лучший). Selected сохраняются при rescore-all (admin меняет grader, но осознанный выбор участника остаётся).
>
> **Native deltas**: зелёные/красные стрелки на native-LB работают через in-memory snapshot per competition, обновляемый worker'ом после каждого scored сабмита.

- [ ] **Step 2: ROUTES.md**

Добавить:

```
### Кабинет

| Method | Path | Auth |
| --- | --- | --- |
| GET | /api/me | required |
| PATCH | /api/me | required |
| POST | /api/me/password | required |
| GET | /api/me/competitions | required |
| GET | /api/me/submissions[?limit=N&offset=N] | required |

### Membership

| Method | Path | Auth |
| --- | --- | --- |
| POST | /api/competitions/<slug>/join | required |
| DELETE | /api/competitions/<slug>/members/me | required |
| GET | /api/competitions/<slug>/membership | optional (anon → isMember=false) |

### Selected submissions

| Method | Path | Auth |
| --- | --- | --- |
| PUT | /api/competitions/<slug>/native-tasks/<task>/submissions/<id>/select | required (owner only); body `{ selected: bool }` |
```

В таблице полей submissions упомянуть `selected: 0|1` и `previousPoints`/`previousTotalPoints` на лидерборд-rows.

- [ ] **Step 3: Commit**

```bash
GIT_TERMINAL_PROMPT=0 git --no-pager add new_lb/README.md new_lb/ROUTES.md
GIT_TERMINAL_PROMPT=0 git --no-pager commit -m "docs(sp4): cabinet + selected + deltas + membership routes"
```

---

## Self-review

**Spec coverage:**
- ✓ Migration 0004 (selected + indexes) — Task 1.1
- ✓ usersRepo.updateProfile + updatePassword — Task 1.2
- ✓ competitionMembersRepo — Task 1.3
- ✓ submissionsRepo.setSelected + countSelected + listAllByUser — Task 1.4
- ✓ GET/PATCH /api/me — Task 2.1
- ✓ POST /api/me/password — Task 2.2
- ✓ /api/me/competitions + /api/me/submissions — Task 2.3
- ✓ Membership endpoints (join/leave/membership) — Task 3.1
- ✓ PUT /submissions/:id/select — Task 4.1
- ✓ Native private LB selected fallback — Task 4.2
- ✓ snapshotCache + annotateDeltas — Task 5.1
- ✓ Worker hook + leaderboard endpoint deltas — Task 5.2
- ✓ Frontend api helpers — Task 6.1
- ✓ Profile + Password sections — Task 6.2
- ✓ MyCompetitions + MySubmissionsCabinet — Task 6.3
- ✓ MePage + routes + UserMenu — Task 6.4
- ✓ JoinButton — Task 7.1
- ✓ Selected toggle в MySubmissions — Task 7.2
- ✓ Smoke — Task 8.1
- ✓ Docs — Task 8.2

**Plan check:** placeholder'ов нет; имена методов согласованы (`updateUserProfile`/`updateUserPassword`/`findUserByIdWithHash`/`joinCompetition`/`leaveCompetition`/`isMember`/`getMembership`/`listMembershipsForUser`/`setSubmissionSelected`/`countSelectedForUserTask`/`listAllSubmissionsForUser`/`makeSnapshotCache`/`setOnScoredCallback`).

**Tricky predicted:**

- Task 1.4 — `submissionsRepo.COLS` константа в SP-3 не включала `selected`. Импл-план явно говорит проверить и добавить. Без этого `getSubmission` не возвращает selected, и frontend toggle ломается.
- Task 2.2 — нужна функция `findUserByIdWithHash` потому что существующий `findUserById` не отдаёт hash наружу. Импл-план это явно прописывает.
- Task 4.2 — SQLite FULL OUTER JOIN: better-sqlite3 ^11 идёт на 3.45+, всё ОК. Если упадёт на старой SQLite — fallback на UNION двух LEFT JOIN-ов.
- Task 5.2 — критично: snapshot обновляется ТОЛЬКО в worker'е (а не на каждом /leaderboard request'e), иначе deltas всегда null. Замечание явное.
- Task 7.2 — `submissions.listMine` должна возвращать поле `selected` (проверь `publicSubmissionForUser` в submissionsPublic.js); если нет — добавь, иначе toggle покажет неправильное состояние.

---

## Critical paths to remember

- **Не сломать kaggle.** Native — единственный путь, который меняется. Kaggle `/leaderboard` без изменений (snapshot инфраструктура работает только для type=native). Regression test в Task 8.1 step 9.
- **Snapshot пишется только worker'ом, а не endpoint'ом.** Если эндпоинт каждый запрос обновляет snapshot, deltas всегда null. Endpoint только READS из cache.
- **Selected при rescore-all сохраняется.** Existing `resetAllForRescore` в `submissionsRepo` обнуляет `points_*`/`raw_score_*`/`error_message` НО НЕ `selected`. Проверь это в SP-3 коде; если зануляет — поправь.
- **`participants.json` НЕ ТРОГАЕМ.** SP-4 из roadmap'a обещал deprecate, но мы намеренно отложили (см. spec). Kaggle «ours» продолжает читать json.
- **`x-admin-token` НЕ удаляем.** Остаётся как fallback. SP-4 не вводит deprecation warning в логи (отложено).
- **Auto-join из SP-3 остаётся.** JoinButton — только UX-улучшение для тех кто хочет «зайти раньше первого сабмита». Двойной вход не страшен (INSERT IGNORE).
- **FULL OUTER JOIN на SQLite ≥3.39** — better-sqlite3 ^11 удовлетворяет. Если когда-то downgrade — переписать на UNION.
