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
