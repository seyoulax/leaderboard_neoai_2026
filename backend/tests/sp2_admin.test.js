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

  const c = await fetch(base, {
    method: 'POST',
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ slug: 't1', title: 'T1', descriptionMd: '# Hello' }),
  });
  assert.equal(c.status, 200);
  const cb = await c.json();
  assert.equal(cb.task.slug, 't1');

  const g = await fetch(base, { headers: ADMIN_HEADERS });
  const gb = await g.json();
  assert.equal(gb.tasks.length, 1);

  const u = await fetch(`${base}/t1`, {
    method: 'PUT', headers: ADMIN_HEADERS,
    body: JSON.stringify({ title: 'T1-updated', baselineScorePublic: 0.5, authorScorePublic: 0.9 }),
  });
  const ub = await u.json();
  assert.equal(ub.task.title, 'T1-updated');
  assert.equal(ub.task.baselineScorePublic, 0.5);

  const d = await fetch(`${base}/t1`, { method: 'DELETE', headers: ADMIN_HEADERS });
  assert.equal(d.status, 200);
  const g2 = await fetch(base, { headers: ADMIN_HEADERS });
  const g2b = await g2.json();
  assert.equal(g2b.tasks.length, 0);
  server.close();
});

test('admin native-tasks: 400 для kaggle competition', async () => {
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/kg/native-tasks`, {
    method: 'POST', headers: ADMIN_HEADERS,
    body: JSON.stringify({ slug: 't', title: 'T' }),
  });
  assert.equal(r.status, 400);
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

test('admin native-tasks: PUT file updates metadata', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const { body, boundary } = multipartBody('a.csv', 'x');
  const u = await fetch(`${base}/t/files?kind=dataset`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-admin-token': 'shared' },
    body,
  });
  const file = (await u.json()).file;
  const p = await fetch(`${base}/t/files/${file.id}`, {
    method: 'PUT', headers: ADMIN_HEADERS,
    body: JSON.stringify({ displayName: 'NEW', description: 'd', displayOrder: 5 }),
  });
  const j = await p.json();
  assert.equal(j.file.displayName, 'NEW');
  assert.equal(j.file.description, 'd');
  assert.equal(j.file.displayOrder, 5);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('admin native-tasks: DELETE file removes row + disk file', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const { body, boundary } = multipartBody('a.csv', 'x');
  const u = await fetch(`${base}/t/files?kind=dataset`, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-admin-token': 'shared' },
    body,
  });
  const file = (await u.json()).file;
  assert.ok(fs.existsSync(file.path));
  const d = await fetch(`${base}/t/files/${file.id}`, { method: 'DELETE', headers: ADMIN_HEADERS });
  assert.equal(d.status, 200);
  assert.equal(fs.existsSync(file.path), false);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

function rawFileBody(filename, content, mime = 'application/octet-stream') {
  const boundary = '----X';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

test('admin native-tasks: PUT grader writes path; replaces previous', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const a = rawFileBody('score.py', 'print(1)');
  const r1 = await fetch(`${base}/t/grader`, {
    method: 'PUT',
    headers: { 'content-type': `multipart/form-data; boundary=${a.boundary}`, 'x-admin-token': 'shared' },
    body: a.body,
  });
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.ok(j1.path.endsWith('grader.py'));
  assert.ok(fs.existsSync(j1.path));
  const list = await fetch(base, { headers: ADMIN_HEADERS });
  const lj = await list.json();
  assert.ok(lj.tasks[0].graderPath);
  // replace
  const b = rawFileBody('score2.py', 'print(2)');
  const r2 = await fetch(`${base}/t/grader`, {
    method: 'PUT',
    headers: { 'content-type': `multipart/form-data; boundary=${b.boundary}`, 'x-admin-token': 'shared' },
    body: b.body,
  });
  assert.equal(r2.status, 200);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('admin native-tasks: DELETE grader → graderPath null + file gone', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const a = rawFileBody('score.py', 'print(1)');
  const upload = await fetch(`${base}/t/grader`, {
    method: 'PUT',
    headers: { 'content-type': `multipart/form-data; boundary=${a.boundary}`, 'x-admin-token': 'shared' },
    body: a.body,
  });
  const uploadJ = await upload.json();
  assert.ok(fs.existsSync(uploadJ.path));
  const d = await fetch(`${base}/t/grader`, { method: 'DELETE', headers: ADMIN_HEADERS });
  assert.equal(d.status, 200);
  assert.equal(fs.existsSync(uploadJ.path), false);
  const list = await fetch(base, { headers: ADMIN_HEADERS });
  const lj = await list.json();
  assert.equal(lj.tasks[0].graderPath, null);
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('admin native-tasks: PUT ground-truth same shape', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const a = rawFileBody('truth.csv', 'id,y\n1,2\n');
  const r = await fetch(`${base}/t/ground-truth`, {
    method: 'PUT',
    headers: { 'content-type': `multipart/form-data; boundary=${a.boundary}`, 'x-admin-token': 'shared' },
    body: a.body,
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.path.endsWith('ground_truth.csv'));
  fs.rmSync(tmp, { recursive: true, force: true });
  server.close();
});

test('admin native-tasks: PUT grader exceeds MAX_GRADER_BYTES → 413', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp2-'));
  process.env.NATIVE_DATA_DIR = tmp;
  process.env.MAX_GRADER_BYTES = '5';
  const { app } = setup();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api/admin/competitions/comp/native-tasks`;
  await fetch(base, { method: 'POST', headers: ADMIN_HEADERS, body: JSON.stringify({ slug: 't', title: 'T' }) });
  const a = rawFileBody('big.py', '0123456789');
  const r = await fetch(`${base}/t/grader`, {
    method: 'PUT',
    headers: { 'content-type': `multipart/form-data; boundary=${a.boundary}`, 'x-admin-token': 'shared' },
    body: a.body,
  });
  assert.equal(r.status, 413);
  delete process.env.MAX_GRADER_BYTES;
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
