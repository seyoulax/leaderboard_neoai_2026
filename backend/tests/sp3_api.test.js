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
  delete process.env.SUBMISSION_ALLOWED_EXTS;
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('POST /submissions: rate limit → 429', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3api-'));
  process.env.NATIVE_DATA_DIR = tmp;
  process.env.MAX_SUBMISSIONS_PER_DAY = '2';
  const { db, app, userId, cookie } = await setupApp();
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

test('admin: GET all submissions, POST /rescore, DELETE one', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3-adm-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { db, app, userId } = await setupApp();
  const { insertSubmission, markScored, pickAndMarkScoring } = await import('../src/db/submissionsRepo.js');
  const sub = insertSubmission(db, { taskId: 1, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markScored(db, sub.id, { rawScorePublic: 0.5, pointsPublic: 50, log: '', durationMs: 1 });
  const server = await start(app);
  const port = server.address().port;

  const list = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/native-tasks/t/submissions`, {
    headers: { 'x-admin-token': 'shared' },
  }).then((r) => r.json());
  assert.equal(list.submissions.length, 1);

  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/native-tasks/t/submissions/${sub.id}/rescore`, {
    method: 'POST', headers: { 'x-admin-token': 'shared' },
  });
  assert.equal(r.status, 200);
  const got = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/${sub.id}`, {
    headers: { 'x-admin-token': 'shared', cookie: '' },
  });
  // admin token doesn't carry user, so /submissions/:id (which uses requireAuth + ownership) returns 401
  // Verify directly via DB instead:
  const fromDb = db.prepare('SELECT status, points_public FROM submissions WHERE id=?').get(sub.id);
  assert.equal(fromDb.status, 'pending');
  assert.equal(fromDb.points_public, null);

  // DELETE
  const fakePath = path.join(tmp, 'fake.csv');
  fs.writeFileSync(fakePath, 'x');
  db.prepare("UPDATE submissions SET path = ? WHERE id = ?").run(fakePath, sub.id);
  const d = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/native-tasks/t/submissions/${sub.id}`, {
    method: 'DELETE', headers: { 'x-admin-token': 'shared' },
  });
  assert.equal(d.status, 200);
  assert.equal(fs.existsSync(fakePath), false);

  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('admin PUT /ground-truth-private + DELETE: пишет/обнуляет groundTruthPrivatePath', async () => {
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

test('GET /submissions/me: список своих сабмитов', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3api-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { db, app, userId, cookie } = await setupApp();
  const { insertSubmission } = await import('../src/db/submissionsRepo.js');
  insertSubmission(db, { taskId: 1, userId, originalFilename: 'a.csv', sizeBytes: 1, sha256: 'x', path: '/a' });

  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/native-tasks/t/submissions/me`, {
    headers: { cookie },
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.submissions.length, 1);
  assert.equal(j.submissions[0].originalFilename, 'a.csv');
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});
