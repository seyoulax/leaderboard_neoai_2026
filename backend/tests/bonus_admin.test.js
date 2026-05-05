import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runMigrations } from '../src/db/index.js';
import { createApp, bootstrapForTests, DATA_DIR } from '../src/app.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import {
  joinCompetition,
  getMembership,
  setBonusPoints,
} from '../src/db/membersRepo.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
function startApp(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }

async function setup() {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const app = createApp({ db });
  await bootstrapForTests();
  return { db, app };
}

const ADMIN = { 'content-type': 'application/json', 'x-admin-token': 'shared' };

test('PUT /admin/competitions/:slug/overall-show-bonus: writes state.json + reflects in cache', async (t) => {
  const { app } = await setup();
  const compDir = path.join(DATA_DIR, 'competitions', 'c');
  t.after(() => fs.rm(compDir, { recursive: true, force: true }));
  const server = await startApp(app);
  const port = server.address().port;
  // toggle ON
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/overall-show-bonus`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ show: true }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.overallShowBonusPoints, true);
  // disk
  const raw = await fs.readFile(path.join(compDir, 'state.json'), 'utf8');
  assert.equal(JSON.parse(raw).overallShowBonusPoints, true);
  // toggle OFF
  const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/overall-show-bonus`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ show: false }),
  });
  assert.equal(r2.status, 200);
  const raw2 = await fs.readFile(path.join(compDir, 'state.json'), 'utf8');
  assert.equal(JSON.parse(raw2).overallShowBonusPoints, false);
  server.close();
});

test('PUT /overall-show-bonus: 400 non-boolean body, 404 unknown slug, 401 no token', async () => {
  const { app } = await setup();
  const server = await startApp(app);
  const port = server.address().port;
  const r1 = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/overall-show-bonus`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ show: 'true' }),
  });
  assert.equal(r1.status, 400);
  const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/nope/overall-show-bonus`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ show: true }),
  });
  assert.equal(r2.status, 404);
  const r3 = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/overall-show-bonus`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ show: true }),
  });
  assert.equal(r3.status, 401);
  server.close();
});

test('PUT /admin/competitions/:slug/members/:userId/bonus-points: updates row', async () => {
  const { db, app } = await setup();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  joinCompetition(db, 'c', u.id);
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/members/${u.id}/bonus-points`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ bonusPoints: 12 }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.bonusPoints, 12);
  assert.equal(getMembership(db, 'c', u.id).bonusPoints, 12);
  server.close();
});

test('PUT /members/:userId/bonus-points: creates membership row if missing', async () => {
  const { db, app } = await setup();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  // No joinCompetition.
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/members/${u.id}/bonus-points`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ bonusPoints: 7 }),
  });
  assert.equal(r.status, 200);
  const m = getMembership(db, 'c', u.id);
  assert.ok(m);
  assert.equal(m.bonusPoints, 7);
  server.close();
});

test('PUT /members/:userId/bonus-points: 400 NaN, 404 unknown comp, 400 non-numeric body', async () => {
  const { db, app } = await setup();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const server = await startApp(app);
  const port = server.address().port;
  const r1 = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/members/${u.id}/bonus-points`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ bonusPoints: 'abc' }),
  });
  assert.equal(r1.status, 400);
  const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/nope/members/${u.id}/bonus-points`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ bonusPoints: 5 }),
  });
  assert.equal(r2.status, 404);
  server.close();
});

test('GET /admin/competitions/:slug/members-bonus: lists ALL members + their bonus', async () => {
  const { db, app } = await setup();
  const u1 = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'kA' });
  const u2 = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'B' });
  const u3 = createUser(db, { email: 'c@c.c', passwordHash: 'h', displayName: 'C' });
  joinCompetition(db, 'c', u1.id);
  joinCompetition(db, 'c', u2.id);
  // u3 not a member
  setBonusPoints(db, 'c', u1.id, 10);
  // u2 has 0
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/members-bonus`, {
    headers: { 'x-admin-token': 'shared' },
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.members.length, 2);
  const a = j.members.find((m) => m.userId === u1.id);
  const b = j.members.find((m) => m.userId === u2.id);
  assert.equal(a.bonusPoints, 10);
  assert.equal(a.kaggleId, 'ka');
  assert.equal(a.displayName, 'A');
  assert.equal(a.email, 'a@a.a');
  assert.equal(b.bonusPoints, 0);
  // u3 absent
  assert.equal(j.members.find((m) => m.userId === u3.id), undefined);
  server.close();
});

test('GET /members-bonus: 401 anon, 404 unknown slug', async () => {
  const { app } = await setup();
  const server = await startApp(app);
  const port = server.address().port;
  const r1 = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/c/members-bonus`);
  assert.equal(r1.status, 401);
  const r2 = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/nope/members-bonus`, {
    headers: { 'x-admin-token': 'shared' },
  });
  assert.equal(r2.status, 404);
  server.close();
});

// ─── boards.showBonusPoints validator + flow-through ───────────────

test('PUT /admin/.../boards: showBonusPoints flows through', async (t) => {
  const { db, app } = await setup();
  insertCompetition(db, { slug: 'k', title: 'K', type: 'kaggle', visibility: 'public' });
  await bootstrapForTests();
  const compDir = path.join(DATA_DIR, 'competitions', 'k');
  t.after(() => fs.rm(compDir, { recursive: true, force: true }));
  await fs.mkdir(compDir, { recursive: true });
  // tasks first
  const server = await startApp(app);
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/admin/competitions/k/tasks`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ tasks: [{ slug: 't1', title: 'T1', competition: 'foo' }] }),
  });
  // boards with showBonusPoints
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/k/boards`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({
      boards: [
        { slug: 'b1', title: 'B1', taskSlugs: ['t1'], showBonusPoints: true },
        { slug: 'b2', title: 'B2', taskSlugs: ['t1'] },
      ],
    }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.boards[0].showBonusPoints, true);
  assert.equal(j.boards[1].showBonusPoints, false);
  // GET reads back
  const g = await fetch(`http://127.0.0.1:${port}/api/competitions/k/boards`).then((x) => x.json());
  assert.equal(g.boards[0].showBonusPoints, true);
  assert.equal(g.boards[1].showBonusPoints, false);
  server.close();
});

// ─── Kaggle participants accept bonusPoints ────────────────────────

test('PUT /admin/.../participants: bonusPoints field flows through', async (t) => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'k', title: 'K', type: 'kaggle', visibility: 'public' });
  const app = createApp({ db });
  await bootstrapForTests();
  const compDir = path.join(DATA_DIR, 'competitions', 'k');
  t.after(() => fs.rm(compDir, { recursive: true, force: true }));
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/k/participants`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({
      participants: [
        { id: 'p1', name: 'Alice X', kaggleId: 'alice', bonusPoints: 25 },
        { id: 'p2', name: 'Bob Y', kaggleId: 'bob' },
      ],
    }),
  });
  assert.equal(r.status, 200);
  // read back
  const g = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/k/participants`, {
    headers: { 'x-admin-token': 'shared' },
  }).then((x) => x.json());
  const a = g.participants.find((p) => p.id === 'p1');
  assert.equal(a.bonusPoints, 25);
  server.close();
});
