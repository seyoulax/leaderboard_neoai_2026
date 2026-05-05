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

test('POST /api/competitions/:slug/join: first → joined; repeat → alreadyMember', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r1 = await fetch(`http://127.0.0.1:${port}/api/competitions/c/join`, { method: 'POST', headers: { cookie } }).then((x) => x.json());
  assert.equal(r1.alreadyMember, false);
  const r2 = await fetch(`http://127.0.0.1:${port}/api/competitions/c/join`, { method: 'POST', headers: { cookie } }).then((x) => x.json());
  assert.equal(r2.alreadyMember, true);
  server.close();
});

test('POST /join: 401 anon', async () => {
  const { app } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/join`, { method: 'POST' });
  assert.equal(r.status, 401);
  server.close();
});

test('DELETE /api/competitions/:slug/members/me: deletes; repeat is idempotent (200)', async () => {
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

test('GET /api/competitions/:slug/membership: anon → isMember=false (no 401)', async () => {
  const { app } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/membership`).then((x) => x.json());
  assert.equal(r.isMember, false);
  assert.equal(r.joinedAt, null);
  server.close();
});

test('GET /membership: member → isMember=true + joinedAt', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/competitions/c/join`, { method: 'POST', headers: { cookie } });
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/membership`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(r.isMember, true);
  assert.ok(r.joinedAt);
  server.close();
});

test('POST /join: 404 for nonexistent competition', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/nope/join`, { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 404);
  server.close();
});

test('GET /membership: 404 for nonexistent competition', async () => {
  const { app } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/nope/membership`);
  assert.equal(r.status, 404);
  server.close();
});
