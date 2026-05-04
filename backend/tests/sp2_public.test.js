import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from '../src/db/index.js';
import { createApp, bootstrapForTests } from '../src/app.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

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

function multipartBody(filename, content, mime = 'text/csv') {
  const boundary = '----X';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="display_name"\r\n\r\n${filename}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

async function uploadFile(port, content, name = 'a.csv') {
  const { body, boundary } = multipartBody(name, content);
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks/t/files?kind=dataset`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-admin-token': 'shared' },
    body,
  });
  return (await r.json()).file;
}

async function userSession(db) {
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A' });
  const s = createSession(db, { userId: u.id, ttlMs: 60_000 });
  return { user: u, cookie: `${SESSION_COOKIE}=${s.id}` };
}

test('public: GET tasks list + GET task detail (no grader path)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const adminBase = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(adminBase, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T', descriptionMd: '# Hi' }) });
  await uploadFile(port, 'a,b\n');

  const list = await fetch(`http://127.0.0.1:${port}/api/competitions/comp/native-tasks`).then((r) => r.json());
  assert.equal(list.tasks.length, 1);
  assert.equal(list.tasks[0].slug, 't');

  const detail = await fetch(`http://127.0.0.1:${port}/api/competitions/comp/native-tasks/t`).then((r) => r.json());
  assert.equal(detail.task.descriptionMd, '# Hi');
  assert.equal(detail.task.datasets.length, 1);
  assert.equal(detail.task.datasets[0].path, undefined); // path stripped
  assert.equal(detail.task.graderPath, undefined); // grader path stripped

  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('public: 404 for non-existent task', async () => {
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/comp/native-tasks/nope`);
  assert.equal(r.status, 404);
  server.close();
});

test('public: 404 for kaggle competition', async () => {
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/kg/native-tasks/t`);
  assert.equal(r.status, 404);
  server.close();
});

test('public: GET file streams content for logged-in user', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { db, app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const adminBase = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(adminBase, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const file = await uploadFile(port, 'hello\n', 'h.csv');

  const { cookie } = await userSession(db);
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/comp/native-tasks/t/files/${file.id}`, {
    headers: { cookie },
  });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'hello\n');

  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('public: GET file 401 for anonymous', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const adminBase = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(adminBase, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const file = await uploadFile(port, 'x', 'x.csv');
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/comp/native-tasks/t/files/${file.id}`);
  assert.equal(r.status, 401);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('public: GET .zip bundles all files of given kind', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { db, app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const adminBase = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(adminBase, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  await uploadFile(port, 'one\n', 'one.csv');
  await uploadFile(port, 'two\n', 'two.csv');

  const { cookie } = await userSession(db);
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/comp/native-tasks/t/files.zip?kind=dataset`, {
    headers: { cookie },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.ok(buf.length > 0);
  assert.equal(buf.slice(0, 2).toString(), 'PK'); // ZIP magic

  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('GET /leaderboard: native dispatch returns native tasks (no kaggle cc)', async () => {
  const { app } = setup();
  await bootstrapForTests();
  const server = await start(app);
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`, {
    method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }),
  });
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/comp/leaderboard`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.tasks.length, 1);
  assert.equal(j.tasks[0].slug, 't');
  assert.deepEqual(j.overall, []);
  server.close();
});

test('public: GET .zip 404 if kind has no files', async () => {
  const { db, app } = setup();
  const server = await start(app);
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`, {
    method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }),
  });
  const { cookie } = await userSession(db);
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/comp/native-tasks/t/files.zip?kind=dataset`, {
    headers: { cookie },
  });
  assert.equal(r.status, 404);
  server.close();
});
