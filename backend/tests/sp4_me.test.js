import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

async function setup() {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  const u = createUser(db, {
    email: 'a@a.a',
    passwordHash: await hashPassword('p'),
    displayName: 'A',
  });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const app = createApp({ db });
  return { db, app, userId: u.id, cookie: `${SESSION_COOKIE}=${sess.id}` };
}

async function start(app) {
  return new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
}

test('GET /api/me: returns profile', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie } }).then((x) =>
    x.json()
  );
  assert.equal(r.user.email, 'a@a.a');
  assert.equal(r.user.role, 'participant');
  assert.equal(r.user.passwordHash, undefined, 'passwordHash MUST NOT leak in response');
  server.close();
});

test('GET /api/me: 401 anon', async () => {
  const { app } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me`);
  assert.equal(r.status, 401);
  server.close();
});

test('PATCH /api/me: changes displayName', async () => {
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
  assert.equal(body.user.passwordHash, undefined);
  server.close();
});

test('PATCH /api/me: email collision → 400', async () => {
  const { db, app, cookie } = await setup();
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

test('PATCH /api/me: invalid email → 400', async () => {
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
