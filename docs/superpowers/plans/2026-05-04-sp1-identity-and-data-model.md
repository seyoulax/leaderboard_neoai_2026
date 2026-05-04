# SP-1 — Identity & Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заложить фундамент «своей Kaggle»: SQLite-БД с identity (users/sessions), таблицу `competitions` с полем `type: kaggle | native`, миграцию существующего `competitions.json` → БД, регистрацию/логин участников, админ-роль вместо shared-токена. Существующие kaggle-соревнования (`neoai-2026`) продолжают работать без изменений.

**Architecture:** SQLite через `better-sqlite3` (single-file БД в `data/app.db`). Auth = email+пароль (`bcryptjs`) + сессия в HTTP-only cookie, сессии в той же БД. Объём миграции: `competitions.json` → таблица `competitions` (one-shot при первом старте, бэкап в `_legacy-backup-<ts>/`); `participants.json`, `tasks.json`, `boards.json`, `state.json`, `private/*.csv` остаются на диске. Все админ-эндпоинты `/api/admin/competitions*` переключаются с JSON на репозиторий БД; refresh-loop читает каталог из БД и пропускает не-kaggle соревнования. Фронт получает `/login` + `/register`, шапку с логаутом, поле `type` в админ-форме соревнования.

**Tech Stack:** Node 20 (Express + `node:test`), `better-sqlite3` ^11, `bcryptjs` ^2, `cookie` ^0.6 (только parser), React 18 + Vite + react-router-dom 6.

**Spec:** `docs/superpowers/specs/2026-05-04-sp1-identity-and-data-model-design.md`

---

## File Structure

### Backend

| File | Status | Responsibility |
| --- | --- | --- |
| `backend/package.json` | modify | +`better-sqlite3`, `bcryptjs`, `cookie` |
| `backend/src/db/index.js` | **create** | Singleton better-sqlite3 + `runMigrations()` |
| `backend/src/db/migrations/0001_init.sql` | **create** | Schema из спеки |
| `backend/src/db/usersRepo.js` | **create** | CRUD + lookup |
| `backend/src/db/sessionsRepo.js` | **create** | create/get/delete/cleanup |
| `backend/src/db/competitionsRepo.js` | **create** | listActive / listAll / get / upsert / softDelete |
| `backend/src/db/membersRepo.js` | **create** | shell для SP-3 (создаём таблицу, файл пустой) |
| `backend/src/auth/bcrypt.js` | **create** | hash / verify |
| `backend/src/auth/sessions.js` | **create** | create/destroy session + cookie helpers |
| `backend/src/auth/middleware.js` | **create** | `loadUser`, `requireAuth`, `requireAdmin` |
| `backend/src/auth/rateLimit.js` | **create** | in-memory token bucket per IP |
| `backend/src/routes/auth.js` | **create** | register / login / logout / me |
| `backend/src/dataMigration/competitionsJsonToDb.js` | **create** | One-shot import + бэкап + удаление json |
| `backend/src/bootstrapAdmin.js` | **create** | Создание admin'а из env (идемпотентно) |
| `backend/src/app.js` | modify | replace `requireAdmin`, mount `loadUser` + `/api/auth`, переключить `/api/admin/competitions*` на репозиторий, в `refreshAll` skip non-kaggle |
| `backend/src/index.js` | modify | open DB → runMigrations → competitionsJsonToDb → bootstrapAdmin → existing migrate() → refreshAll |
| `backend/src/competitions.js` | unchanged | `validateCompetitions` остаётся (используется в репо и one-shot миграции) |
| `backend/.env.example` | modify | +`DB_FILE`, `SESSION_TTL_DAYS`, `COOKIE_SECURE`, `ADMIN_BOOTSTRAP_*` |
| `backend/Dockerfile` | inspect (likely unchanged) | `bcryptjs` чисто-JS, `better-sqlite3` имеет prebuilt binaries |
| `backend/tests/db.test.js` | **create** | runMigrations + repos |
| `backend/tests/auth.test.js` | **create** | bcrypt + middleware + auth routes integration |
| `backend/tests/dataMigration.test.js` | **create** | competitionsJsonToDb fixture import |
| `backend/tests/adminCompetitions.test.js` | **create** | Admin endpoints против БД, оба пути auth |

### Frontend

| File | Status | Responsibility |
| --- | --- | --- |
| `frontend/vite.config.js` | modify | dev-proxy `/api` → `:3001` чтобы cookie работали same-origin |
| `frontend/src/api.js` | modify | `credentials: 'include'`, добавить `auth.{register,login,logout,me}` |
| `frontend/src/auth/AuthContext.jsx` | **create** | Контекст + хук `useAuth()` |
| `frontend/src/auth/LoginPage.jsx` | **create** | `/login` |
| `frontend/src/auth/RegisterPage.jsx` | **create** | `/register` |
| `frontend/src/UserMenu.jsx` | **create** | Шапка: имя + logout, либо ссылки на login/register |
| `frontend/src/AdminCompetitionsPage.jsx` | modify | поле `type` (radio kaggle/native) |
| `frontend/src/App.jsx` | modify | `<AuthProvider>` обёртка, routes `/login` `/register`, `<UserMenu/>` в шапке |

### Docs

| File | Status |
| --- | --- |
| `new_lb/README.md` | modify (env-таблица + dev-flow) |
| `new_lb/ROUTES.md` | modify (новые `/api/auth/*`, поле `type`, изменённый `requireAdmin`) |

---

## Phase 0 — Подготовка

### Task 0.1: Установить зависимости

**Files:**
- Modify: `backend/package.json`, `backend/package-lock.json`

- [ ] **Step 1: Добавить deps**

В `backend/`:
```bash
npm install better-sqlite3@^11 bcryptjs@^2 cookie@^0.6
```

- [ ] **Step 2: Проверить что собирается в Docker (smoke)**

```bash
cd new_lb && docker compose build backend
```

Expected: успешная сборка. `better-sqlite3` тянет prebuilt binaries для node:20 alpine — если базовый образ требует доустановки `python3 make g++`, дописать в `backend/Dockerfile` перед `npm ci`. Если сборка зелёная — ничего не трогать.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/Dockerfile
git commit -m "chore(deps): add better-sqlite3, bcryptjs, cookie"
```

---

## Phase 1 — DB foundation

### Task 1.1: DB singleton + migrations runner

**Files:**
- Create: `backend/src/db/index.js`, `backend/src/db/migrations/0001_init.sql`
- Create: `backend/tests/db.test.js`

- [ ] **Step 1: Написать падающий тест на runMigrations**

`backend/tests/db.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';

test('runMigrations: applies 0001_init on empty DB', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const row = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  assert.deepEqual(row, [{ version: 1 }]);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes('users'));
  assert.ok(tables.includes('sessions'));
  assert.ok(tables.includes('competitions'));
  assert.ok(tables.includes('competition_members'));
});

test('runMigrations: idempotent (second call no-op)', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  runMigrations(db);
  const versions = db.prepare("SELECT version FROM schema_migrations").all();
  assert.equal(versions.length, 1);
});
```

- [ ] **Step 2: Запустить — упадёт**

```bash
cd backend && node --test tests/db.test.js
```
Expected: FAIL — `Cannot find module '../src/db/index.js'`.

- [ ] **Step 3: Создать `0001_init.sql`**

`backend/src/db/migrations/0001_init.sql` — точный SQL из спеки, секция «Schema». Скопировать оттуда без изменений (включая PRAGMA на самом верху).

- [ ] **Step 4: Реализовать `db/index.js`**

```js
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let _db = null;

export function getDb() {
  if (_db) return _db;
  const file = process.env.DB_FILE
    ? path.resolve(process.env.DB_FILE)
    : path.resolve(process.cwd(), 'data', 'app.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  _db = new Database(file);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);
  return _db;
}

export function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  for (const f of files) {
    const version = Number(f.match(/^(\d+)_/)[1]);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    })();
  }
}

export function resetDbForTests() {
  if (_db) _db.close();
  _db = null;
}
```

Замечание: `0001_init.sql` уже содержит `CREATE TABLE schema_migrations` — `IF NOT EXISTS` в раннере выше делает создание идемпотентным; в файле миграции версия 0001 опускает `schema_migrations` (раннер сам её создаёт первым). Удалить блок `schema_migrations` из `0001_init.sql`.

- [ ] **Step 5: Прогнать тесты — должны пройти**

```bash
cd backend && node --test tests/db.test.js
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db backend/tests/db.test.js
git commit -m "feat(db): sqlite singleton + migrations runner with 0001_init"
```

---

### Task 1.2: usersRepo

**Files:**
- Create: `backend/src/db/usersRepo.js`
- Modify: `backend/tests/db.test.js` (добавить в тот же файл блок тестов)

- [ ] **Step 1: Тест-хелпер `freshDb()`**

В начало `backend/tests/db.test.js` добавить:
```js
import { runMigrations } from '../src/db/index.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}
```

- [ ] **Step 2: Написать падающие тесты для usersRepo**

```js
import { createUser, findUserByEmail, findUserById, setUserRole, updateKaggleId } from '../src/db/usersRepo.js';

test('usersRepo.createUser + findUserByEmail (case-insensitive)', () => {
  const db = freshDb();
  const u = createUser(db, {
    email: 'Foo@Bar.com',
    passwordHash: 'h',
    displayName: 'Foo',
    kaggleId: null,
  });
  assert.equal(u.role, 'participant');
  assert.equal(u.email, 'Foo@Bar.com');
  const found = findUserByEmail(db, 'foo@bar.com');
  assert.equal(found.id, u.id);
});

test('usersRepo.createUser: duplicate email throws', () => {
  const db = freshDb();
  createUser(db, { email: 'x@y.z', passwordHash: 'h', displayName: 'A' });
  assert.throws(
    () => createUser(db, { email: 'X@Y.Z', passwordHash: 'h', displayName: 'B' }),
    /UNIQUE/i
  );
});

test('usersRepo.createUser: duplicate kaggleId throws, null ok', () => {
  const db = freshDb();
  createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'kid1' });
  createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'B', kaggleId: null });
  createUser(db, { email: 'c@c.c', passwordHash: 'h', displayName: 'C', kaggleId: null });
  assert.throws(
    () => createUser(db, { email: 'd@d.d', passwordHash: 'h', displayName: 'D', kaggleId: 'kid1' }),
    /UNIQUE/i
  );
});

test('usersRepo.setUserRole + findUserById', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  setUserRole(db, u.id, 'admin');
  assert.equal(findUserById(db, u.id).role, 'admin');
});
```

- [ ] **Step 3: Запустить — упадут**

```bash
cd backend && node --test tests/db.test.js
```
Expected: FAIL — модуль не найден.

- [ ] **Step 4: Реализовать репо**

`backend/src/db/usersRepo.js`:
```js
const COLUMNS = 'id, email, password_hash AS passwordHash, display_name AS displayName, kaggle_id AS kaggleId, role, created_at AS createdAt';

export function createUser(db, { email, passwordHash, displayName, kaggleId = null }) {
  const result = db
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, kaggle_id)
       VALUES (?, ?, ?, ?)`
    )
    .run(email, passwordHash, displayName, kaggleId ? String(kaggleId).toLowerCase() : null);
  return findUserById(db, result.lastInsertRowid);
}

export function findUserById(db, id) {
  return db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) || null;
}

export function findUserByEmail(db, email) {
  return db
    .prepare(`SELECT ${COLUMNS} FROM users WHERE email = ? COLLATE NOCASE`)
    .get(email) || null;
}

export function setUserRole(db, id, role) {
  if (role !== 'participant' && role !== 'admin') throw new Error(`bad role: ${role}`);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

export function updateKaggleId(db, id, kaggleId) {
  db.prepare('UPDATE users SET kaggle_id = ? WHERE id = ?').run(
    kaggleId ? String(kaggleId).toLowerCase() : null,
    id
  );
}

export function countAdmins(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
}
```

- [ ] **Step 5: Тесты — PASS**

```bash
cd backend && node --test tests/db.test.js
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/usersRepo.js backend/tests/db.test.js
git commit -m "feat(db): usersRepo (create/find/role)"
```

---

### Task 1.3: sessionsRepo

**Files:**
- Create: `backend/src/db/sessionsRepo.js`
- Modify: `backend/tests/db.test.js`

- [ ] **Step 1: Падающие тесты**

```js
import {
  createSession,
  findSessionWithUser,
  deleteSession,
  cleanupExpired,
  touchSessionExpiry,
} from '../src/db/sessionsRepo.js';

test('sessionsRepo: create → findWithUser → delete', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  assert.ok(sess.id);
  assert.ok(sess.expiresAt);
  const got = findSessionWithUser(db, sess.id);
  assert.equal(got.user.id, u.id);
  assert.equal(got.user.email, 'a@a.a');
  deleteSession(db, sess.id);
  assert.equal(findSessionWithUser(db, sess.id), null);
});

test('sessionsRepo.findSessionWithUser: expired returns null', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: -1 });
  assert.equal(findSessionWithUser(db, sess.id), null);
});

test('sessionsRepo.cleanupExpired removes expired only', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const expired = createSession(db, { userId: u.id, ttlMs: -1 });
  const live = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const removed = cleanupExpired(db);
  assert.equal(removed, 1);
  assert.equal(findSessionWithUser(db, expired.id), null);
  assert.ok(findSessionWithUser(db, live.id));
});

test('sessionsRepo.touchSessionExpiry extends expiresAt', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const before = sess.expiresAt;
  touchSessionExpiry(db, sess.id, 86_400_000);
  const got = findSessionWithUser(db, sess.id);
  assert.ok(got.expiresAt > before);
});
```

- [ ] **Step 2: Запустить — FAIL**

- [ ] **Step 3: Реализация**

`backend/src/db/sessionsRepo.js`:
```js
import crypto from 'node:crypto';

function newSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}

function plusMsIso(ms) {
  return new Date(Date.now() + ms).toISOString();
}

export function createSession(db, { userId, ttlMs }) {
  const id = newSessionId();
  const expiresAt = plusMsIso(ttlMs);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    id,
    userId,
    expiresAt
  );
  return { id, userId, expiresAt };
}

export function findSessionWithUser(db, id) {
  const row = db
    .prepare(
      `SELECT s.id AS sessionId, s.expires_at AS expiresAt,
              u.id, u.email, u.display_name AS displayName, u.kaggle_id AS kaggleId, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(id, nowIso());
  if (!row) return null;
  return {
    id: row.sessionId,
    expiresAt: row.expiresAt,
    user: {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      kaggleId: row.kaggleId,
      role: row.role,
    },
  };
}

export function deleteSession(db, id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function deleteAllUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function cleanupExpired(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}

export function touchSessionExpiry(db, id, ttlMs) {
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(plusMsIso(ttlMs), id);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/sessionsRepo.js backend/tests/db.test.js
git commit -m "feat(db): sessionsRepo (create/find/delete/cleanup/touch)"
```

---

### Task 1.4: competitionsRepo

**Files:**
- Create: `backend/src/db/competitionsRepo.js`
- Modify: `backend/tests/db.test.js`

- [ ] **Step 1: Тесты**

```js
import {
  insertCompetition,
  upsertCompetition,
  listActiveCompetitions,
  listVisibleCompetitions,
  getCompetition,
  softDeleteCompetition,
  bulkReplaceCompetitions,
} from '../src/db/competitionsRepo.js';

test('competitionsRepo.insertCompetition + getCompetition', () => {
  const db = freshDb();
  const c = insertCompetition(db, {
    slug: 'foo',
    title: 'Foo',
    type: 'kaggle',
    visible: true,
    displayOrder: 0,
  });
  assert.equal(c.slug, 'foo');
  assert.equal(c.type, 'kaggle');
  assert.equal(c.visible, true);
  assert.equal(getCompetition(db, 'foo').title, 'Foo');
});

test('competitionsRepo.softDeleteCompetition hides from listActive', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  insertCompetition(db, { slug: 'b', title: 'B', type: 'native' });
  softDeleteCompetition(db, 'a');
  const active = listActiveCompetitions(db);
  assert.deepEqual(active.map((c) => c.slug), ['b']);
});

test('competitionsRepo.listVisibleCompetitions excludes invisible', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle', visible: true });
  insertCompetition(db, { slug: 'b', title: 'B', type: 'native', visible: false });
  assert.deepEqual(listVisibleCompetitions(db).map((c) => c.slug), ['a']);
});

test('competitionsRepo.bulkReplaceCompetitions: missing slugs → soft-deleted', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  insertCompetition(db, { slug: 'b', title: 'B', type: 'native' });
  bulkReplaceCompetitions(db, [
    { slug: 'a', title: 'A2', type: 'kaggle', visible: true, displayOrder: 1 },
    { slug: 'c', title: 'C', type: 'native', visible: true, displayOrder: 2 },
  ]);
  const active = listActiveCompetitions(db).map((c) => c.slug).sort();
  assert.deepEqual(active, ['a', 'c']);
  assert.equal(getCompetition(db, 'a').title, 'A2');
});

test('competitionsRepo.upsertCompetition writes new and updates existing', () => {
  const db = freshDb();
  upsertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  upsertCompetition(db, { slug: 'a', title: 'A2', type: 'native' });
  const c = getCompetition(db, 'a');
  assert.equal(c.title, 'A2');
  assert.equal(c.type, 'native');
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/db/competitionsRepo.js`:
```js
const COLUMNS = `slug, title, subtitle, type,
  CAST(visible AS INTEGER) AS visible,
  display_order AS displayOrder,
  created_at AS createdAt,
  deleted_at AS deletedAt`;

function rowToCompetition(row) {
  if (!row) return null;
  return { ...row, visible: row.visible === 1 };
}

export function insertCompetition(db, c) {
  db.prepare(
    `INSERT INTO competitions (slug, title, subtitle, type, visible, display_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    c.slug,
    c.title,
    c.subtitle ?? null,
    c.type,
    c.visible === false ? 0 : 1,
    Number.isFinite(c.displayOrder) ? c.displayOrder : 0
  );
  return getCompetition(db, c.slug);
}

export function upsertCompetition(db, c) {
  const existing = db.prepare('SELECT slug FROM competitions WHERE slug = ?').get(c.slug);
  if (existing) {
    db.prepare(
      `UPDATE competitions
       SET title = ?, subtitle = ?, type = ?, visible = ?, display_order = ?, deleted_at = NULL
       WHERE slug = ?`
    ).run(
      c.title,
      c.subtitle ?? null,
      c.type,
      c.visible === false ? 0 : 1,
      Number.isFinite(c.displayOrder) ? c.displayOrder : 0,
      c.slug
    );
  } else {
    insertCompetition(db, c);
  }
  return getCompetition(db, c.slug);
}

export function getCompetition(db, slug) {
  return rowToCompetition(
    db.prepare(`SELECT ${COLUMNS} FROM competitions WHERE slug = ?`).get(slug)
  );
}

export function listActiveCompetitions(db) {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM competitions
       WHERE deleted_at IS NULL
       ORDER BY display_order, slug`
    )
    .all()
    .map(rowToCompetition);
}

export function listVisibleCompetitions(db) {
  return listActiveCompetitions(db).filter((c) => c.visible);
}

export function softDeleteCompetition(db, slug) {
  db.prepare('UPDATE competitions SET deleted_at = ? WHERE slug = ?').run(
    new Date().toISOString(),
    slug
  );
}

export function bulkReplaceCompetitions(db, list) {
  const incoming = new Set(list.map((c) => c.slug));
  db.transaction(() => {
    for (const c of list) upsertCompetition(db, c);
    const existing = db
      .prepare('SELECT slug FROM competitions WHERE deleted_at IS NULL')
      .all()
      .map((r) => r.slug);
    for (const slug of existing) {
      if (!incoming.has(slug)) softDeleteCompetition(db, slug);
    }
  })();
  return listActiveCompetitions(db);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/competitionsRepo.js backend/tests/db.test.js
git commit -m "feat(db): competitionsRepo (CRUD + soft delete + bulk replace)"
```

---

### Task 1.5: membersRepo shell

**Files:**
- Create: `backend/src/db/membersRepo.js`

- [ ] **Step 1: Создать пустой shell**

```js
// SP-3 заполнит этот файл (join native, list members, kaggle_id linking).
// Таблица competition_members уже создана в 0001_init для будущего использования.
export {};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/db/membersRepo.js
git commit -m "chore(db): membersRepo shell for SP-3"
```

---

## Phase 2 — Auth helpers

### Task 2.1: bcrypt wrapper

**Files:**
- Create: `backend/src/auth/bcrypt.js`
- Create: `backend/tests/auth.test.js`

- [ ] **Step 1: Падающий тест**

`backend/tests/auth.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/bcrypt.js';

test('bcrypt: hash → verify happy path', async () => {
  const hash = await hashPassword('hunter2');
  assert.notEqual(hash, 'hunter2');
  assert.equal(await verifyPassword('hunter2', hash), true);
});

test('bcrypt: verify rejects wrong password', async () => {
  const hash = await hashPassword('hunter2');
  assert.equal(await verifyPassword('wrong', hash), false);
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/auth/bcrypt.js`:
```js
import bcrypt from 'bcryptjs';

const COST = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/bcrypt.js backend/tests/auth.test.js
git commit -m "feat(auth): bcrypt hash/verify wrapper"
```

---

### Task 2.2: Cookie + session helpers

**Files:**
- Create: `backend/src/auth/sessions.js`
- Modify: `backend/tests/auth.test.js`

- [ ] **Step 1: Тесты**

```js
import { parse as parseCookie } from 'cookie';
import {
  SESSION_COOKIE,
  buildSessionCookie,
  buildClearCookie,
  getCookieFromReq,
  sessionTtlMs,
} from '../src/auth/sessions.js';

test('sessions.buildSessionCookie: HttpOnly + correct id', () => {
  const cookie = buildSessionCookie('sess123', { secure: false });
  assert.match(cookie, /^session=sess123/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Secure/);
});

test('sessions.buildSessionCookie: Secure when secure=true', () => {
  const cookie = buildSessionCookie('sess123', { secure: true });
  assert.match(cookie, /Secure/);
});

test('sessions.buildClearCookie: Max-Age=0', () => {
  const cookie = buildClearCookie({ secure: false });
  assert.match(cookie, /^session=;/);
  assert.match(cookie, /Max-Age=0/);
});

test('sessions.getCookieFromReq', () => {
  const req = { headers: { cookie: 'session=abc; foo=bar' } };
  assert.equal(getCookieFromReq(req), 'abc');
  assert.equal(getCookieFromReq({ headers: {} }), null);
});

test('sessions.sessionTtlMs: from env or default', () => {
  delete process.env.SESSION_TTL_DAYS;
  assert.equal(sessionTtlMs(), 30 * 24 * 60 * 60 * 1000);
  process.env.SESSION_TTL_DAYS = '7';
  assert.equal(sessionTtlMs(), 7 * 24 * 60 * 60 * 1000);
  delete process.env.SESSION_TTL_DAYS;
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/auth/sessions.js`:
```js
import { parse, serialize } from 'cookie';

export const SESSION_COOKIE = 'session';

export function sessionTtlMs() {
  const days = Number(process.env.SESSION_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 30) * 24 * 60 * 60 * 1000;
}

function isSecureRequest(req) {
  const env = (process.env.COOKIE_SECURE || 'auto').toLowerCase();
  if (env === 'true') return true;
  if (env === 'false') return false;
  if (!req) return false;
  if (req.protocol === 'https') return true;
  const xfp = req.headers?.['x-forwarded-proto'];
  return typeof xfp === 'string' && xfp.split(',')[0].trim() === 'https';
}

export function cookieOptionsFromReq(req) {
  return { secure: isSecureRequest(req) };
}

export function buildSessionCookie(id, { secure }) {
  return serialize(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!secure,
    path: '/',
    maxAge: Math.floor(sessionTtlMs() / 1000),
  });
}

export function buildClearCookie({ secure }) {
  return serialize(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!secure,
    path: '/',
    maxAge: 0,
  });
}

export function getCookieFromReq(req) {
  const header = req?.headers?.cookie;
  if (!header) return null;
  const parsed = parse(header);
  return parsed[SESSION_COOKIE] || null;
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/sessions.js backend/tests/auth.test.js
git commit -m "feat(auth): session cookie helpers"
```

---

### Task 2.3: Rate limit (token bucket)

**Files:**
- Create: `backend/src/auth/rateLimit.js`
- Modify: `backend/tests/auth.test.js`

- [ ] **Step 1: Тесты**

```js
import { makeRateLimiter } from '../src/auth/rateLimit.js';

test('rateLimit: allows up to N then blocks', () => {
  const rl = makeRateLimiter({ max: 3, windowMs: 60_000 });
  for (let i = 0; i < 3; i++) assert.equal(rl.allow('1.2.3.4'), true);
  assert.equal(rl.allow('1.2.3.4'), false);
  assert.equal(rl.allow('5.6.7.8'), true);
});

test('rateLimit: window resets after time passes', () => {
  let now = 1000;
  const rl = makeRateLimiter({ max: 1, windowMs: 1000, now: () => now });
  assert.equal(rl.allow('ip'), true);
  assert.equal(rl.allow('ip'), false);
  now += 1500;
  assert.equal(rl.allow('ip'), true);
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/auth/rateLimit.js`:
```js
export function makeRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const buckets = new Map(); // key → { count, resetAt }
  return {
    allow(key) {
      const t = now();
      const b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        buckets.set(key, { count: 1, resetAt: t + windowMs });
        return true;
      }
      if (b.count >= max) return false;
      b.count += 1;
      return true;
    },
  };
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/rateLimit.js backend/tests/auth.test.js
git commit -m "feat(auth): in-memory token-bucket rate limiter"
```

---

### Task 2.4: Auth middleware

**Files:**
- Create: `backend/src/auth/middleware.js`
- Modify: `backend/tests/auth.test.js`

- [ ] **Step 1: Тесты**

```js
import express from 'express';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { runMigrations } from '../src/db/index.js';
import Database from 'better-sqlite3';
import { hashPassword } from '../src/auth/bcrypt.js';
import { loadUser, requireAuth, requireAdmin } from '../src/auth/middleware.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

function makeApp(db) {
  const app = express();
  app.use(loadUser({ db }));
  app.get('/anon', (req, res) => res.json({ user: req.user || null }));
  app.get('/protected', requireAuth, (req, res) => res.json({ user: req.user }));
  app.get('/admin', requireAdmin({ adminToken: 'shared-token' }), (req, res) =>
    res.json({ ok: true })
  );
  return app;
}

test('middleware.loadUser: anonymous request → req.user = null', async () => {
  const db = freshDb();
  const app = makeApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/anon`);
  const json = await r.json();
  assert.equal(json.user, null);
  server.close();
});

test('middleware.loadUser: valid cookie → req.user populated', async () => {
  const db = freshDb();
  const u = createUser(db, {
    email: 'a@a.a',
    passwordHash: await hashPassword('p'),
    displayName: 'A',
  });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const app = makeApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/protected`, {
    headers: { cookie: `${SESSION_COOKIE}=${sess.id}` },
  });
  const json = await r.json();
  assert.equal(json.user.id, u.id);
  server.close();
});

test('middleware.requireAuth: 401 without session', async () => {
  const db = freshDb();
  const app = makeApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/protected`);
  assert.equal(r.status, 401);
  server.close();
});

test('middleware.requireAdmin: admin session passes', async () => {
  const db = freshDb();
  const u = createUser(db, {
    email: 'a@a.a',
    passwordHash: 'h',
    displayName: 'A',
  });
  db.prepare("UPDATE users SET role='admin' WHERE id = ?").run(u.id);
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const app = makeApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/admin`, {
    headers: { cookie: `${SESSION_COOKIE}=${sess.id}` },
  });
  assert.equal(r.status, 200);
  server.close();
});

test('middleware.requireAdmin: x-admin-token fallback', async () => {
  const db = freshDb();
  const app = makeApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/admin`, {
    headers: { 'x-admin-token': 'shared-token' },
  });
  assert.equal(r.status, 200);
  const r2 = await fetch(`http://127.0.0.1:${port}/admin`, {
    headers: { 'x-admin-token': 'wrong' },
  });
  assert.equal(r2.status, 401);
  const r3 = await fetch(`http://127.0.0.1:${port}/admin`);
  assert.equal(r3.status, 401);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/auth/middleware.js`:
```js
import crypto from 'node:crypto';
import {
  findSessionWithUser,
  touchSessionExpiry,
  deleteSession,
} from '../db/sessionsRepo.js';
import {
  getCookieFromReq,
  buildClearCookie,
  cookieOptionsFromReq,
  sessionTtlMs,
} from './sessions.js';

const TOUCH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function loadUser({ db }) {
  return function (req, _res, next) {
    req.user = null;
    req.session = null;
    const id = getCookieFromReq(req);
    if (!id) return next();
    const sess = findSessionWithUser(db, id);
    if (!sess) return next();
    req.user = sess.user;
    req.session = sess;
    if (new Date(sess.expiresAt).getTime() - Date.now() < TOUCH_THRESHOLD_MS) {
      try { touchSessionExpiry(db, id, sessionTtlMs()); } catch {}
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
}

function safeEqualToken(provided, expected) {
  const a = Buffer.from(provided || '', 'utf8');
  const b = Buffer.from(expected || '', 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function requireAdmin({ adminToken } = {}) {
  return function (req, res, next) {
    if (req.user?.role === 'admin') return next();
    const provided = req.get('x-admin-token') || '';
    if (adminToken && provided && safeEqualToken(provided, adminToken)) {
      console.warn('[admin] x-admin-token fallback used (deprecate after SP-4)');
      return next();
    }
    if (provided) {
      res.status(401).json({ error: 'invalid admin token' });
      return;
    }
    if (req.user) {
      res.status(403).json({ error: 'admin role required' });
      return;
    }
    res.status(401).json({ error: 'authentication required' });
  };
}

// Helper для logout: явная очистка cookie на ответе.
export function clearSessionCookie(req, res) {
  const opts = cookieOptionsFromReq(req);
  res.setHeader('Set-Cookie', buildClearCookie(opts));
}

// Помощник: текущая сессия → удалить из БД и почистить cookie.
export function destroyCurrentSession(req, res, db) {
  if (req.session) {
    try { deleteSession(db, req.session.id); } catch {}
  }
  clearSessionCookie(req, res);
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/auth/middleware.js backend/tests/auth.test.js
git commit -m "feat(auth): loadUser + requireAuth + requireAdmin (with token fallback)"
```

---

## Phase 3 — Auth routes

### Task 3.1: /api/auth/* endpoints

**Files:**
- Create: `backend/src/routes/auth.js`
- Modify: `backend/tests/auth.test.js`

- [ ] **Step 1: Тесты integration**

Добавить в `auth.test.js` блок:
```js
import { createAuthRouter } from '../src/routes/auth.js';

function makeAuthApp(db) {
  const app = express();
  app.use(express.json());
  app.use(loadUser({ db }));
  app.use('/api/auth', createAuthRouter({ db }));
  return app;
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, headers: r.headers };
}

test('auth routes: register → me → logout flow', async () => {
  const db = freshDb();
  const app = makeAuthApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const reg = await fetchJson(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'a@a.a', password: 'hunter2hunter2', displayName: 'A',
    }),
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.json.user.email, 'a@a.a');
  const setCookie = reg.headers.get('set-cookie');
  assert.match(setCookie, /^session=/);
  const cookie = setCookie.split(';')[0];

  const me = await fetchJson(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.json.user.email, 'a@a.a');

  const lo = await fetchJson(`${base}/api/auth/logout`, {
    method: 'POST', headers: { cookie },
  });
  assert.equal(lo.status, 200);
  const cleared = lo.headers.get('set-cookie');
  assert.match(cleared, /Max-Age=0/);

  const me2 = await fetchJson(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me2.json.user, null);

  server.close();
});

test('auth routes: register validation', async () => {
  const db = freshDb();
  const app = makeAuthApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const r = await fetchJson(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'bad', password: 'short', displayName: '' }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('auth routes: login wrong password', async () => {
  const db = freshDb();
  const app = makeAuthApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  await fetchJson(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@a.a', password: 'hunter2hunter2', displayName: 'A' }),
  });
  const r = await fetchJson(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@a.a', password: 'wrong' }),
  });
  assert.equal(r.status, 401);
  server.close();
});

test('auth routes: register duplicate email returns 400', async () => {
  const db = freshDb();
  const app = makeAuthApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const body = JSON.stringify({ email: 'a@a.a', password: 'hunter2hunter2', displayName: 'A' });
  const a = await fetchJson(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  assert.equal(a.status, 200);
  const b = await fetchJson(`http://127.0.0.1:${port}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  assert.equal(b.status, 400);
  server.close();
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/routes/auth.js`:
```js
import { Router } from 'express';
import { createUser, findUserByEmail } from '../db/usersRepo.js';
import { createSession } from '../db/sessionsRepo.js';
import { hashPassword, verifyPassword } from '../auth/bcrypt.js';
import {
  buildSessionCookie,
  cookieOptionsFromReq,
  sessionTtlMs,
} from '../auth/sessions.js';
import { destroyCurrentSession } from '../auth/middleware.js';
import { makeRateLimiter } from '../auth/rateLimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegisterInput(body) {
  const errors = [];
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const displayName = String(body?.displayName || '').trim();
  const kaggleId = body?.kaggleId == null ? null : String(body.kaggleId).trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) errors.push('invalid email');
  if (password.length < 8 || password.length > 256) errors.push('password must be 8–256 chars');
  if (!displayName || displayName.length > 80) errors.push('displayName must be 1–80 chars');
  if (kaggleId && (!/^[a-z0-9-]+$/.test(kaggleId) || kaggleId.length > 80)) {
    errors.push('invalid kaggleId');
  }
  return { ok: errors.length === 0, errors, email, password, displayName, kaggleId };
}

function userPublic(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    kaggleId: u.kaggleId,
    role: u.role,
  };
}

function setSessionCookie(req, res, sessionId) {
  res.setHeader('Set-Cookie', buildSessionCookie(sessionId, cookieOptionsFromReq(req)));
}

export function createAuthRouter({ db }) {
  const router = Router();
  const loginLimit = makeRateLimiter({ max: 10, windowMs: 60_000 });
  const registerLimit = makeRateLimiter({ max: 10, windowMs: 60_000 });

  router.post('/register', async (req, res) => {
    if (!registerLimit.allow(req.ip || 'anon')) {
      res.status(429).json({ error: 'too many requests' });
      return;
    }
    const v = validateRegisterInput(req.body);
    if (!v.ok) {
      res.status(400).json({ error: v.errors.join('; ') });
      return;
    }
    const passwordHash = await hashPassword(v.password);
    let user;
    try {
      user = createUser(db, {
        email: v.email,
        passwordHash,
        displayName: v.displayName,
        kaggleId: v.kaggleId,
      });
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) {
        res.status(400).json({ error: 'email or kaggleId already in use' });
        return;
      }
      throw e;
    }
    const sess = createSession(db, { userId: user.id, ttlMs: sessionTtlMs() });
    setSessionCookie(req, res, sess.id);
    res.json({ user: userPublic(user) });
  });

  router.post('/login', async (req, res) => {
    if (!loginLimit.allow(req.ip || 'anon')) {
      res.status(429).json({ error: 'too many requests' });
      return;
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = findUserByEmail(db, email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: 'invalid credentials' });
      return;
    }
    const sess = createSession(db, { userId: user.id, ttlMs: sessionTtlMs() });
    setSessionCookie(req, res, sess.id);
    res.json({ user: userPublic(user) });
  });

  router.post('/logout', (req, res) => {
    destroyCurrentSession(req, res, db);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: userPublic(req.user) });
  });

  return router;
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/auth.js backend/tests/auth.test.js
git commit -m "feat(auth): /api/auth/{register,login,logout,me}"
```

---

## Phase 4 — Data migration + bootstrap

### Task 4.1: One-shot competitions.json → DB

**Files:**
- Create: `backend/src/dataMigration/competitionsJsonToDb.js`
- Create: `backend/tests/dataMigration.test.js`

- [ ] **Step 1: Тесты с фикстурой**

`backend/tests/dataMigration.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { listActiveCompetitions } from '../src/db/competitionsRepo.js';
import { migrateCompetitionsJsonToDb } from '../src/dataMigration/competitionsJsonToDb.js';

function makeTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp1-mig-'));
  return dir;
}

test('competitionsJsonToDb: imports legacy json + backs up + deletes', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const dataDir = makeTempDataDir();
  const jsonFile = path.join(dataDir, 'competitions.json');
  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      [
        { slug: 'neoai-2026', title: 'NEOAI', subtitle: 'Sub', order: 0, visible: true },
        { slug: 'foo', title: 'Foo', visible: false },
      ],
      null,
      2
    )
  );
  const result = migrateCompetitionsJsonToDb({ db, dataDir });
  assert.equal(result.migrated, true);
  assert.equal(result.count, 2);
  assert.ok(result.backupFile && fs.existsSync(result.backupFile));
  assert.equal(fs.existsSync(jsonFile), false);
  const list = listActiveCompetitions(db).map((c) => c.slug).sort();
  assert.deepEqual(list, ['foo', 'neoai-2026']);
  const nat = listActiveCompetitions(db).find((c) => c.slug === 'neoai-2026');
  assert.equal(nat.type, 'kaggle');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('competitionsJsonToDb: idempotent — runs once even if file reappears', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const dataDir = makeTempDataDir();
  fs.writeFileSync(
    path.join(dataDir, 'competitions.json'),
    JSON.stringify([{ slug: 'a', title: 'A' }])
  );
  migrateCompetitionsJsonToDb({ db, dataDir });
  fs.writeFileSync(
    path.join(dataDir, 'competitions.json'),
    JSON.stringify([{ slug: 'b', title: 'B' }])
  );
  const result = migrateCompetitionsJsonToDb({ db, dataDir });
  assert.equal(result.migrated, false);
  const list = listActiveCompetitions(db).map((c) => c.slug);
  assert.deepEqual(list, ['a']);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('competitionsJsonToDb: no-op when no json file exists', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const dataDir = makeTempDataDir();
  const result = migrateCompetitionsJsonToDb({ db, dataDir });
  assert.equal(result.migrated, false);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/dataMigration/competitionsJsonToDb.js`:
```js
import fs from 'node:fs';
import path from 'node:path';
import { validateCompetitions } from '../competitions.js';
import {
  insertCompetition,
  listActiveCompetitions,
} from '../db/competitionsRepo.js';

export function migrateCompetitionsJsonToDb({ db, dataDir }) {
  // Запуск только если БД пустая (никогда раньше не мигрировали).
  if (listActiveCompetitions(db).length > 0) {
    return { migrated: false, reason: 'db not empty' };
  }
  const file = path.join(dataDir, 'competitions.json');
  if (!fs.existsSync(file)) {
    return { migrated: false, reason: 'no legacy file' };
  }

  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  const validated = validateCompetitions(parsed);

  db.transaction(() => {
    for (const c of validated) {
      insertCompetition(db, {
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle ?? null,
        type: 'kaggle',
        visible: c.visible !== false,
        displayOrder: Number.isFinite(c.order) ? c.order : 0,
      });
    }
  })();

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, `_legacy-backup-${ts}`);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, 'competitions.json');
  fs.copyFileSync(file, backupFile);
  fs.rmSync(file);

  return { migrated: true, count: validated.length, backupFile };
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/dataMigration backend/tests/dataMigration.test.js
git commit -m "feat(migrate): one-shot competitions.json → SQLite"
```

---

### Task 4.2: bootstrapAdmin

**Files:**
- Create: `backend/src/bootstrapAdmin.js`
- Modify: `backend/tests/auth.test.js`

- [ ] **Step 1: Тесты**

```js
import { bootstrapAdmin } from '../src/bootstrapAdmin.js';
import { findUserByEmail, countAdmins } from '../src/db/usersRepo.js';

test('bootstrapAdmin: creates admin when none exists', async () => {
  const db = freshDb();
  const result = await bootstrapAdmin({
    db,
    email: 'root@x.y',
    password: 'hunter2hunter2',
  });
  assert.equal(result.created, true);
  const u = findUserByEmail(db, 'root@x.y');
  assert.equal(u.role, 'admin');
});

test('bootstrapAdmin: idempotent when admin already exists', async () => {
  const db = freshDb();
  await bootstrapAdmin({ db, email: 'a@a.a', password: 'hunter2hunter2' });
  const result = await bootstrapAdmin({ db, email: 'b@b.b', password: 'hunter2hunter2' });
  assert.equal(result.created, false);
  assert.equal(countAdmins(db), 1);
});

test('bootstrapAdmin: noop when env empty', async () => {
  const db = freshDb();
  const result = await bootstrapAdmin({ db, email: '', password: '' });
  assert.equal(result.created, false);
  assert.equal(countAdmins(db), 0);
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Реализация**

`backend/src/bootstrapAdmin.js`:
```js
import { hashPassword } from './auth/bcrypt.js';
import { createUser, countAdmins, findUserByEmail, setUserRole } from './db/usersRepo.js';

export async function bootstrapAdmin({ db, email, password }) {
  const e = String(email || '').trim().toLowerCase();
  const p = String(password || '');
  if (!e || !p) return { created: false, reason: 'env not set' };
  if (countAdmins(db) > 0) return { created: false, reason: 'admin already exists' };
  const existing = findUserByEmail(db, e);
  if (existing) {
    setUserRole(db, existing.id, 'admin');
    return { created: false, promoted: true, userId: existing.id };
  }
  const u = createUser(db, {
    email: e,
    passwordHash: await hashPassword(p),
    displayName: 'Admin',
  });
  setUserRole(db, u.id, 'admin');
  return { created: true, userId: u.id };
}
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/bootstrapAdmin.js backend/tests/auth.test.js
git commit -m "feat(auth): bootstrapAdmin from env (idempotent)"
```

---

## Phase 5 — Wire up в существующее приложение

### Task 5.1: Подключить DB и миграции в `index.js`

**Files:**
- Modify: `backend/src/index.js`
- Modify: `backend/.env.example`

- [ ] **Step 1: Обновить `index.js`**

```js
import dotenv from 'dotenv';
import path from 'node:path';
import { createApp, refreshAll, DATA_DIR } from './app.js';
import { migrate } from './migrate.js';
import { getDb } from './db/index.js';
import { migrateCompetitionsJsonToDb } from './dataMigration/competitionsJsonToDb.js';
import { bootstrapAdmin } from './bootstrapAdmin.js';
import { cleanupExpired } from './db/sessionsRepo.js';

dotenv.config();

const PORT = Number(process.env.PORT || 3001);
const REFRESH_MS = Number(process.env.REFRESH_MS || 60000);

// Открываем БД и применяем schema-миграции до того, как поднимется HTTP.
process.env.DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'app.db');
const db = getDb();

const app = createApp({ db });

app.listen(PORT, async () => {
  console.log(`Backend started on http://localhost:${PORT}`);
  try {
    const compMig = migrateCompetitionsJsonToDb({ db, dataDir: DATA_DIR });
    if (compMig.migrated) {
      console.log(`[migrate-db] competitions.json → DB (${compMig.count} rows), backup: ${compMig.backupFile}`);
    }
    const admin = await bootstrapAdmin({
      db,
      email: process.env.ADMIN_BOOTSTRAP_EMAIL,
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    });
    if (admin.created) console.log(`[bootstrap] admin created: id=${admin.userId}`);
    else if (admin.promoted) console.log(`[bootstrap] existing user promoted to admin: id=${admin.userId}`);
    const result = await migrate(DATA_DIR);
    if (result.migrated) {
      console.log(`[migrate] OK: legacy → ${result.competitionSlug}, backup: ${result.backupDir}`);
    }
  } catch (e) {
    console.error('[startup] migration FAILED', e);
  }
  await refreshAll();
  setInterval(refreshAll, REFRESH_MS);
  setInterval(() => {
    try { cleanupExpired(db); } catch (e) { console.error('[sessions] cleanup failed', e); }
  }, 60 * 60 * 1000);
});
```

- [ ] **Step 2: Обновить `.env.example`**

```ini
PORT=3001
REFRESH_MS=60000
KAGGLE_CMD=kaggle

# Admin (legacy shared token; кепт как fallback для CI/скриптов).
ADMIN_TOKEN=

# Identity
DB_FILE=./data/app.db
SESSION_TTL_DAYS=30
COOKIE_SECURE=auto

# При первом старте создаст админа если ни одного нет (идемпотентно).
ADMIN_BOOTSTRAP_EMAIL=
ADMIN_BOOTSTRAP_PASSWORD=
```

- [ ] **Step 3: Smoke — поднять backend локально**

```bash
cd backend && cp .env.example .env
# проставить ADMIN_BOOTSTRAP_EMAIL/PASSWORD на тест
ADMIN_BOOTSTRAP_EMAIL=root@x.y ADMIN_BOOTSTRAP_PASSWORD=hunter2hunter2 npm run dev
```
Expected: лог `[migrate-db] ...` если `competitions.json` ещё на месте, потом `[bootstrap] admin created`. Файла `data/competitions.json` после старта быть не должно. В `data/_legacy-backup-<ts>/competitions.json` лежит старый.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.js backend/.env.example
git commit -m "feat(startup): wire DB + migrations + bootstrap"
```

---

### Task 5.2: Переключить `app.js` на репозиторий + новый middleware

Существующий `app.js` (~950 строк) — много правок небольшими блоками. Делаем последовательно, каждый шаг — отдельный коммит, чтобы можно было откатить точечно.

**Files:**
- Modify: `backend/src/app.js`

- [ ] **Step 1: Убрать legacy-импорты, добавить новые**

В шапке `app.js`:
- удалить `import { loadCompetitions, saveCompetitions, validateCompetitions } from './competitions.js';`, оставить ТОЛЬКО `validateCompetitions` (он ещё нужен в админ-PUT для совместимости валидации):
  ```js
  import { validateCompetitions } from './competitions.js';
  ```
- добавить:
  ```js
  import { loadUser, requireAdmin } from './auth/middleware.js';
  import { createAuthRouter } from './routes/auth.js';
  import {
    listActiveCompetitions,
    listVisibleCompetitions,
    getCompetition,
    insertCompetition,
    softDeleteCompetition,
    bulkReplaceCompetitions,
  } from './db/competitionsRepo.js';
  ```
- удалить старый `requireAdmin(req, res, next)` функцию (она теперь в middleware).
- удалить локальную `safeEqualToken` (используется только старым `requireAdmin`).

- [ ] **Step 2: Принять `db` в `createApp`**

```js
export function createApp({ db } = {}) {
  if (!db) throw new Error('createApp({db}) is required');
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
  const adminMw = requireAdmin({ adminToken: ADMIN_TOKEN });
  const app = express();
  app.set('trust proxy', true);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '50mb' }));
  app.use(loadUser({ db }));
  app.use('/api/auth', createAuthRouter({ db }));
  // ... остальное без изменений до admin-секции
```

Все места где было `requireAdmin` (как функция-middleware) → заменить на `adminMw`.

- [ ] **Step 3: Заменить чтение/запись `competitions.json` на репо**

`refreshAll`:
```js
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
      try { await refreshCompetition(comp.slug); }
      catch (e) { console.error(`[refresh] competition ${comp.slug} failed:`, e); }
    }
    cache.lastSweepAt = new Date().toISOString();
  } finally {
    cache.isRefreshing = false;
  }
}
```

Где `getDbHandle()` — приватная переменная, которую `createApp` записывает в module-scope:
```js
let _dbForRefresh = null;
function getDbHandle() {
  if (!_dbForRefresh) throw new Error('refreshAll called before createApp');
  return _dbForRefresh;
}
```
В `createApp({ db })` сразу после валидации: `_dbForRefresh = db;`.

`/api/competitions` (public):
```js
app.get('/api/competitions', (_req, res) => {
  const visible = listVisibleCompetitions(db);
  res.json({ competitions: visible });
});
```

Удалить старую функцию `findCompetitionMeta(slug)` — заменить на:
```js
function findCompetitionMeta(slug) {
  if (!slug) return null;
  const wanted = String(slug).toLowerCase();
  return cache.competitionsIndex.find((c) => c.slug.toLowerCase() === wanted) || null;
}
```
(оставить как есть, `cache.competitionsIndex` теперь из БД).

`ensureKnownSlug(req, res)` — без изменений.

`GET /api/admin/competitions`:
```js
app.get('/api/admin/competitions', adminMw, async (_req, res) => {
  res.json({ competitions: listActiveCompetitions(db) });
});
```

`PUT /api/admin/competitions`:
```js
app.put('/api/admin/competitions', adminMw, async (req, res) => {
  try {
    const validated = validateCompetitions(req.body?.competitions);
    const enriched = validated.map((c) => ({
      ...c,
      type: c.type === 'native' ? 'native' : 'kaggle',
      displayOrder: Number.isFinite(c.order) ? c.order : 0,
    }));
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
```

`POST /api/admin/competitions`:
```js
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
      subtitle: validated.subtitle,
      type: next.type === 'native' ? 'native' : 'kaggle',
      visible: validated.visible !== false,
      displayOrder: Number.isFinite(validated.order) ? validated.order : 0,
    });
    await fs.mkdir(competitionDir(created.slug), { recursive: true });
    cache.competitionsIndex = listActiveCompetitions(db);
    res.json({ ok: true, competition: created });
    refreshAll().catch((e) => console.error('[refresh after admin create] FAILED', e));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
```

`DELETE /api/admin/competitions/:competitionSlug`:
```js
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
    try { await fs.rename(dir, deletedDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    cache.competitionsIndex = listActiveCompetitions(db);
    cache.byCompetition.delete(slug);
    res.json({ ok: true, deleted: slug, archivedAs: deletedDir });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
```

`bootstrapForTests` / `reloadIndex` — переписать на репо:
```js
export async function bootstrapForTests() {
  cache.competitionsIndex = listActiveCompetitions(getDbHandle());
  for (const c of cache.competitionsIndex) {
    if (!cache.byCompetition.has(c.slug)) cache.byCompetition.set(c.slug, emptyCompetitionCache());
  }
}

export async function reloadIndex() {
  cache.competitionsIndex = listActiveCompetitions(getDbHandle());
}
```

- [ ] **Step 4: Smoke — поднять и проверить публичный + админский путь**

```bash
cd backend && npm run dev
# в другом терминале:
curl -s http://localhost:3001/api/competitions | jq .competitions
curl -s -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3001/api/admin/competitions | jq .competitions
```
Expected: оба возвращают `neoai-2026` со всеми полями включая `type: "kaggle"`.

- [ ] **Step 5: Existing tests — должны проходить**

Существующие `tests/competitions.test.js` / `tests/migrate.test.js` / `tests/routing.test.js` тестируют функции, которые мы не сломали (`validateCompetitions` остался, `migrate` остался). Проверить что они зелёные.

```bash
cd backend && npm test
```
Если `routing.test.js` упал — это интеграционный тест, ему нужен `db` для `createApp`. Смотри Task 5.3.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app.js
git commit -m "refactor(app): competitions admin → SQLite, mount auth + loadUser"
```

---

### Task 5.3: Починить существующие тесты под новый `createApp({db})`

**Files:**
- Modify: `backend/tests/routing.test.js`

- [ ] **Step 1: Найти и обновить вызовы `createApp()`**

В `routing.test.js` (и в любых других местах где `createApp` вызывается без аргументов):
```js
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp, bootstrapForTests } from '../src/app.js';

function makeAppWithDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return { app: createApp({ db }), db };
}
```
Заменить все `const app = createApp();` на этот хелпер. Если тест полагается на `bootstrapForTests`, тоже совместимо.

- [ ] **Step 2: Прогнать**

```bash
cd backend && npm test
```
Expected: все тесты зелёные.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/routing.test.js
git commit -m "test: routing tests use in-memory db"
```

---

### Task 5.4: Тесты на admin-эндпоинты против БД

**Files:**
- Create: `backend/tests/adminCompetitions.test.js`

- [ ] **Step 1: Написать тесты**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp, bootstrapForTests } from '../src/app.js';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  process.env.ADMIN_TOKEN = 'shared';
  const app = createApp({ db });
  return { db, app };
}

async function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('admin/competitions: token fallback works', async () => {
  const { app } = fresh();
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
    headers: { 'x-admin-token': 'shared' },
  });
  assert.equal(r.status, 200);
  server.close();
});

test('admin/competitions: 401 без auth', async () => {
  const { app } = fresh();
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`);
  assert.equal(r.status, 401);
  server.close();
});

test('admin/competitions: admin-сессия пускает; participant — 403', async () => {
  const { db, app } = fresh();
  const adminU = createUser(db, {
    email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A',
  });
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminU.id);
  const adminSess = createSession(db, { userId: adminU.id, ttlMs: 60_000 });

  const partU = createUser(db, {
    email: 'b@b.b', passwordHash: await hashPassword('p'), displayName: 'B',
  });
  const partSess = createSession(db, { userId: partU.id, ttlMs: 60_000 });

  const server = await startApp(app);
  const port = server.address().port;
  const okR = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
    headers: { cookie: `${SESSION_COOKIE}=${adminSess.id}` },
  });
  assert.equal(okR.status, 200);
  const forbR = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
    headers: { cookie: `${SESSION_COOKIE}=${partSess.id}` },
  });
  assert.equal(forbR.status, 403);
  server.close();
});

test('admin/competitions: POST создаёт native; GET /api/competitions показывает только visible', async () => {
  const { db, app } = fresh();
  await bootstrapForTests();
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': 'shared' },
    body: JSON.stringify({
      competition: { slug: 'native-1', title: 'Native One', type: 'native', visible: true },
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.competition.type, 'native');
  const pub = await fetch(`http://127.0.0.1:${port}/api/competitions`).then((x) => x.json());
  assert.ok(pub.competitions.some((c) => c.slug === 'native-1'));
  server.close();
});
```

- [ ] **Step 2: Прогнать**

```bash
cd backend && node --test tests/adminCompetitions.test.js
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/adminCompetitions.test.js
git commit -m "test(admin): competitions endpoints with both auth paths"
```

---

## Phase 6 — Frontend

### Task 6.1: Vite dev proxy + api.js auth

**Files:**
- Modify: `frontend/vite.config.js`, `frontend/src/api.js`

- [ ] **Step 1: Дев-прокси для cookie same-origin**

`frontend/vite.config.js`:
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
      },
    },
  },
});
```

- [ ] **Step 2: Обновить `api.js` для работы с cookies + auth-методы**

В начало `api.js`:
```js
const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function request(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const r = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    credentials: 'include',
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const err = new Error(json?.error || r.statusText);
    err.status = r.status;
    err.payload = json;
    throw err;
  }
  return json;
}
```

Все существующие `fetch(...)` вызовы заменить на `request(...)` с теми же путями (минус `${API_BASE}` префикс — он теперь в `request`). Если где-то нужен `x-admin-token` — оставить через `headers`.

В конец `api.js`:
```js
export const auth = {
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
};
```

- [ ] **Step 3: Smoke**

```bash
cd frontend && npm run dev
```
В браузере: открыть DevTools → Network. Любой запрос к `/api/...` должен идти на `:5173` (тот же origin), Vite его проксирует на `:3001`.

- [ ] **Step 4: Commit**

```bash
git add frontend/vite.config.js frontend/src/api.js
git commit -m "feat(fe/api): credentials + dev proxy + auth helpers"
```

---

### Task 6.2: AuthContext

**Files:**
- Create: `frontend/src/auth/AuthContext.jsx`

- [ ] **Step 1: Реализация**

```jsx
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { auth as authApi } from '../api.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await authApi.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email, password) => {
    const { user } = await authApi.login({ email, password });
    setUser(user);
    return user;
  }, []);

  const register = useCallback(async (body) => {
    const { user } = await authApi.register(body);
    setUser(user);
    return user;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth: AuthProvider missing');
  return v;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/auth/AuthContext.jsx
git commit -m "feat(fe/auth): AuthContext + useAuth hook"
```

---

### Task 6.3: LoginPage / RegisterPage / UserMenu

**Files:**
- Create: `frontend/src/auth/LoginPage.jsx`, `frontend/src/auth/RegisterPage.jsx`, `frontend/src/UserMenu.jsx`

- [ ] **Step 1: LoginPage**

```jsx
import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email, password);
      nav(loc.state?.from || '/', { replace: true });
    } catch (e) { setErr(e.message || 'login failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-card">
      <h1>Войти</h1>
      <form onSubmit={submit}>
        <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Пароль <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <div className="error">{err}</div>}
        <button disabled={busy}>{busy ? '…' : 'Войти'}</button>
      </form>
      <p>Нет аккаунта? <Link to="/register">Регистрация</Link></p>
    </div>
  );
}
```

- [ ] **Step 2: RegisterPage**

```jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export default function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', displayName: '', kaggleId: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function set(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await register({ ...form, kaggleId: form.kaggleId || null });
      nav('/');
    } catch (e) { setErr(e.message || 'register failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-card">
      <h1>Регистрация</h1>
      <form onSubmit={submit}>
        <label>Email <input type="email" value={form.email} onChange={set('email')} required /></label>
        <label>Пароль (≥ 8) <input type="password" minLength={8} value={form.password} onChange={set('password')} required /></label>
        <label>Имя <input value={form.displayName} onChange={set('displayName')} required maxLength={80} /></label>
        <label>Kaggle ID (опц.) <input value={form.kaggleId} onChange={set('kaggleId')} placeholder="myname" /></label>
        {err && <div className="error">{err}</div>}
        <button disabled={busy}>{busy ? '…' : 'Создать аккаунт'}</button>
      </form>
      <p>Уже есть аккаунт? <Link to="/login">Войти</Link></p>
    </div>
  );
}
```

- [ ] **Step 3: UserMenu**

```jsx
import { Link } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';

export default function UserMenu() {
  const { user, loading, logout } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <div className="user-menu">
        <Link to="/login">Войти</Link>
        <Link to="/register">Регистрация</Link>
      </div>
    );
  }
  return (
    <div className="user-menu">
      <span title={user.email}>{user.displayName}</span>
      {user.role === 'admin' && <Link to="/admin/competitions">Админка</Link>}
      <button onClick={() => logout()}>Выйти</button>
    </div>
  );
}
```

- [ ] **Step 4: Стили (минимум)**

В `frontend/src/styles.css` добавить:
```css
.auth-card { max-width: 360px; margin: 60px auto; padding: 24px; border: 1px solid #ddd; border-radius: 8px; }
.auth-card form { display: flex; flex-direction: column; gap: 12px; }
.auth-card label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.auth-card input { padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
.auth-card .error { color: #c00; font-size: 14px; }
.auth-card button { padding: 10px; background: #111; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
.user-menu { display: inline-flex; gap: 12px; align-items: center; }
.user-menu button { background: transparent; border: 1px solid #ccc; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auth frontend/src/UserMenu.jsx frontend/src/styles.css
git commit -m "feat(fe): login + register pages + user menu"
```

---

### Task 6.4: Подключить в App.jsx

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Импорты + обёртка + routes**

```jsx
import { AuthProvider } from './auth/AuthContext.jsx';
import LoginPage from './auth/LoginPage.jsx';
import RegisterPage from './auth/RegisterPage.jsx';
import UserMenu from './UserMenu.jsx';
```

В корне `<App>` обернуть всё в `<AuthProvider>`. В шапке (где-то в основной верстке — найти место рядом с brand) вставить `<UserMenu />`.

В `<Routes>` добавить:
```jsx
<Route path="/login" element={<LoginPage />} />
<Route path="/register" element={<RegisterPage />} />
```

- [ ] **Step 2: Smoke в браузере**

```bash
cd frontend && npm run dev   # backend параллельно
```
Open http://localhost:5173. Шапка показывает «Войти / Регистрация». Открыть `/register`, создать пользователя — после редиректа на `/` шапка показывает имя + «Выйти». Кликнуть «Выйти» — снова анон. Зарегиться, в БД (`sqlite3 backend/data/app.db "SELECT email, role FROM users"`) выставить руками `role='admin'`, перелогиниться — в шапке появится «Админка».

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(fe/app): mount AuthProvider + login/register routes + UserMenu"
```

---

### Task 6.5: Поле `type` в админке соревнований

**Files:**
- Modify: `frontend/src/AdminCompetitionsPage.jsx`

- [ ] **Step 1: Добавить radio в форму создания**

В компоненте, где есть форма «новое соревнование» (input slug + title + …), добавить radio для `type`:
```jsx
<fieldset>
  <legend>Тип</legend>
  <label><input type="radio" name="type" value="kaggle" checked={form.type === 'kaggle'} onChange={() => setForm({ ...form, type: 'kaggle' })} /> Kaggle</label>
  <label><input type="radio" name="type" value="native" checked={form.type === 'native'} onChange={() => setForm({ ...form, type: 'native' })} /> Native</label>
</fieldset>
```
Дефолт `type='kaggle'` в `useState(form)`.

В колонке таблицы существующих соревнований показать `competition.type`:
```jsx
<td>{competition.type}</td>
```
Заголовок столбца «Тип».

В пейлоад на `POST /api/admin/competitions` добавить `type: form.type`.

- [ ] **Step 2: Smoke**

В браузере залогиниться админом, на `/admin/competitions` создать новое соревнование с `type=native`. Появится в списке с `type: native`. На `/api/competitions` (публичный) — тоже видно (если `visible=true`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/AdminCompetitionsPage.jsx
git commit -m "feat(fe/admin): competition type radio"
```

---

## Phase 7 — End-to-end smoke + docs

### Task 7.1: Полный smoke свежего деплоя

- [ ] **Step 1: На чистой БД**

```bash
cd backend
rm -f data/app.db
ADMIN_BOOTSTRAP_EMAIL=root@x.y ADMIN_BOOTSTRAP_PASSWORD=hunter2hunter2 npm run dev
```

Лог должен показать:
- `Backend started on http://localhost:3001`
- `[migrate-db] competitions.json → DB (1 rows), backup: …` (если `competitions.json` ещё лежит на диске)
- `[bootstrap] admin created: id=1`

`data/app.db` создан, `data/competitions.json` отсутствует, `data/_legacy-backup-<ts>/competitions.json` лежит.

- [ ] **Step 2: Существующий kaggle-flow жив**

```bash
curl -s http://localhost:3001/api/competitions | jq
curl -s http://localhost:3001/api/competitions/neoai-2026/leaderboard | jq '.tasks | length'
```
Expected: соревнование `neoai-2026` со всеми полями + полноценный лидерборд (тот же что раньше).

- [ ] **Step 3: Login flow**

```bash
curl -i -c /tmp/cj.txt -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"root@x.y","password":"hunter2hunter2"}'
curl -s -b /tmp/cj.txt http://localhost:3001/api/auth/me | jq .
curl -s -b /tmp/cj.txt http://localhost:3001/api/admin/competitions | jq '.competitions | length'
```
Expected: cookie выставлена; `me` возвращает `role: admin`; admin endpoint отвечает 200.

- [ ] **Step 4: Создать native соревнование**

```bash
curl -s -b /tmp/cj.txt -X POST http://localhost:3001/api/admin/competitions \
  -H 'content-type: application/json' \
  -d '{"competition":{"slug":"sandbox","title":"Sandbox","type":"native","visible":true}}'
curl -s http://localhost:3001/api/competitions | jq '.competitions[].slug'
```
Expected: создаётся; в логе нет ошибок Kaggle (refresh пропустил native).

- [ ] **Step 5: Все тесты зелёные**

```bash
cd backend && npm test
```

- [ ] **Step 6: Commit nothing — это smoke. При успехе переходим к docs.**

---

### Task 7.2: Обновить README + ROUTES.md

**Files:**
- Modify: `new_lb/README.md`, `new_lb/ROUTES.md`

- [ ] **Step 1: README — секция «Backend ENV»**

Добавить новые переменные в таблицу:

| Переменная | Дефолт | |
| --- | --- | --- |
| `DB_FILE` | `./data/app.db` | путь к SQLite |
| `SESSION_TTL_DAYS` | `30` | TTL session cookie |
| `COOKIE_SECURE` | `auto` | `true`/`false`/`auto` (по `req.protocol`) |
| `ADMIN_BOOTSTRAP_EMAIL` | (пусто) | при первом старте создаёт админа если ни одного нет |
| `ADMIN_BOOTSTRAP_PASSWORD` | (пусто) | то же |

Дописать в «Локальная разработка» примечание:

> При первом старте бэкенд автоматически создаёт `data/app.db`, переносит `data/competitions.json` в БД (бэкап в `_legacy-backup-<ts>/`), и (если заданы `ADMIN_BOOTSTRAP_*`) создаёт админ-пользователя. Для авторизации в админке вместо `ADMIN_TOKEN` теперь — login через `/login` email+пароль. Старый `x-admin-token` оставлен как fallback для CI.

- [ ] **Step 2: ROUTES.md — добавить раздел auth**

В начало раздела «Backend API» добавить:

```
### Auth

| Method | Path |
| --- | --- |
| POST | /api/auth/register |
| POST | /api/auth/login |
| POST | /api/auth/logout |
| GET  | /api/auth/me |
```

В разделе «Админ»:

> **Аутентификация админ-эндпоинтов.** Принимается либо session-cookie пользователя с `role='admin'`, либо legacy `x-admin-token`. Token-fallback оставлен для CI, депрекейтнут после SP-4.

В таблице полей соревнования добавить `type: 'kaggle' | 'native'`.

- [ ] **Step 3: Commit**

```bash
git add new_lb/README.md new_lb/ROUTES.md
git commit -m "docs: SP-1 (auth, DB env, competition type)"
```

---

## Self-review

**Spec coverage:**
- ✓ SQLite singleton + миграции — Task 1.1
- ✓ Schema (users/sessions/competitions/competition_members) — Task 1.1 (0001_init.sql)
- ✓ usersRepo / sessionsRepo / competitionsRepo / membersRepo — Tasks 1.2–1.5
- ✓ bcrypt — Task 2.1
- ✓ Cookie helpers — Task 2.2
- ✓ Rate limit — Task 2.3
- ✓ Middleware loadUser/requireAuth/requireAdmin (с token-fallback) — Task 2.4
- ✓ /api/auth/{register,login,logout,me} — Task 3.1
- ✓ One-shot competitions.json → DB + бэкап + удаление — Task 4.1
- ✓ bootstrapAdmin — Task 4.2
- ✓ index.js — open DB, run migrations, миграции, bootstrap, refresh-loop — Task 5.1
- ✓ app.js — переключение на репо, новый middleware, type-aware refresh, type для public/admin endpoints — Task 5.2
- ✓ Existing tests fix + admin endpoints tests — Tasks 5.3, 5.4
- ✓ Vite dev proxy + api credentials — Task 6.1
- ✓ AuthContext + Login/Register/UserMenu + App-mount — Tasks 6.2–6.4
- ✓ type radio в админке — Task 6.5
- ✓ Smoke — Task 7.1
- ✓ Docs — Task 7.2

**Plan check:** placeholder'ов нет (нет `TODO`, `TBD`, «similar to», «add error handling»). Каждая задача даёт работающее коммитимое состояние. Имена методов согласованы (`createUser`/`findUserByEmail`/`createSession`/`findSessionWithUser`/`requireAdmin({adminToken})` — везде одинаково).

**Один промежуточный момент:** Task 5.2 правит большой `app.js` несколькими блоками без разделения на отдельные коммиты — допустимо для одного функционального изменения (переезд индекса соревнований на репо), но если правки разрастаются, исполнитель волен бить на под-коммиты.

---

## Critical paths to remember

- **Не сломать kaggle-refresh.** Существующий `neoai-2026` после миграции остаётся `type='kaggle'` и refresh-loop его обрабатывает как раньше. Native просто пропускаются — никакого Kaggle CLI на них.
- **Cookie + CORS dev.** Vite-proxy решает same-origin проблему. В проде nginx уже на одном домене, дополнительной конфигурации не требуется.
- **Token fallback.** `x-admin-token` остаётся живым на всех `/api/admin/*`. Не удалять до окончания SP-4 — может ломаться CI/скрипты.
- **`participants.json` не трогаем.** Kaggle «ours»-фильтр продолжает читать его. Деприкейт — отдельный таск в SP-3.
