import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

test('migration 0005: applied after 0001-0004', () => {
  const db = freshDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((r) => r.version), [1, 2, 3, 4, 5]);
});

test('migration 0005: submissions.selected column exists with default 0', () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(submissions)").all();
  const sel = cols.find((c) => c.name === 'selected');
  assert.ok(sel, 'selected column missing');
  assert.equal(sel.dflt_value, '0');
  assert.equal(sel.notnull, 1);
});

test('migration 0005: selected CHECK constraint', () => {
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

test('migration 0005: existing submission rows get selected=0', () => {
  // Симулируем БД с pre-0005 schema, потом 0005 накатывается. Применяем все миграции
  // кроме 0005 руками, вставляем submission, потом применяем 0005.
  const db = new Database(':memory:');
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)");
  const allFiles = fs.readdirSync(MIG_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const pre = allFiles.filter((f) => !f.startsWith('0005_'));
  for (const f of pre) {
    const version = Number(f.match(/^(\d+)_/)[1]);
    db.exec(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  }
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  db.prepare(`INSERT INTO submissions (task_id, user_id, original_filename, size_bytes, sha256, path)
              VALUES (1, 1, 'x', 1, 'h', '/x')`).run();
  const sql5 = fs.readFileSync(path.join(MIG_DIR, '0005_selected_and_indexes.sql'), 'utf8');
  db.exec(sql5);
  const got = db.prepare("SELECT selected FROM submissions WHERE id = 1").get();
  assert.equal(got.selected, 0);
});

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
  assert.ok(list[0].createdAt >= list[1].createdAt);
});

test('listAllSubmissionsForUser: hides submissions for soft-deleted tasks', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const t2 = insertNativeTask(db, { competitionSlug: 'c', slug: 't2', title: 'T2' });
  makeScoredSub(db, taskId, userId, 70);
  makeScoredSub(db, t2.id, userId, 80);
  db.prepare("UPDATE native_tasks SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(t2.id);
  const list = listAllSubmissionsForUser(db, userId);
  assert.equal(list.length, 1);
  assert.equal(list[0].taskSlug, 't');
});

test('listAllSubmissionsForUser: hides submissions for soft-deleted competitions', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  makeScoredSub(db, taskId, userId, 70);
  db.prepare("UPDATE competitions SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = 'c'").run();
  const list = listAllSubmissionsForUser(db, userId);
  assert.equal(list.length, 0);
});

import { createApp } from '../src/app.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

async function startApp(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }

test('PUT /submissions/:id/select: marks submission as selected', async () => {
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

test('PUT /select: third select when 2 already → 400', async () => {
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

test('PUT /select: re-selecting an already-selected submission is fine (no double-count)', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const a = makeScoredSub(db, t.id, u.id, 70);
  const b = makeScoredSub(db, t.id, u.id, 80);
  setSubmissionSelected(db, a, true);
  setSubmissionSelected(db, b, true);
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const cookie = `${SESSION_COOKIE}=${sess.id}`;
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  // PUT select=true on already-selected `a` should still succeed (count unchanged)
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${a}/select`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selected: true }),
  });
  assert.equal(r.status, 200);
  server.close();
});

test('PUT /select: unselect (selected=false) decrements', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const a = makeScoredSub(db, t.id, u.id, 70);
  setSubmissionSelected(db, a, true);
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const cookie = `${SESSION_COOKIE}=${sess.id}`;
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${a}/select`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selected: false }),
  });
  assert.equal(r.status, 200);
  assert.equal(getSubmission(db, a).selected, 0);
  server.close();
});

test('PUT /select: someone else submission → 404', async () => {
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

test('PUT /select: pending (not scored) submission → 400', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  // pending sub (no markScored)
  const sub = insertSubmission(db, { taskId: t.id, userId: u.id, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: '/x' });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const cookie = `${SESSION_COOKIE}=${sess.id}`;
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${sub.id}/select`, {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ selected: true }),
  });
  assert.equal(r.status, 400);
  server.close();
});

test('publicSubmission shape includes selected field', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const subId = makeScoredSub(db, t.id, u.id, 70);
  setSubmissionSelected(db, subId, true);
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const cookie = `${SESSION_COOKIE}=${sess.id}`;
  const app = createApp({ db });
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${subId}`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(r.submission.selected, 1);
  server.close();
});
