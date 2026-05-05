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
import { insertNativeTask } from '../src/db/nativeTasksRepo.js';
import { joinCompetition } from '../src/db/membersRepo.js';
import {
  insertSubmission,
  pickAndMarkScoring,
  markScored,
} from '../src/db/submissionsRepo.js';

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

test('PATCH /api/me: passwordHash never leaks in collision response', async () => {
  const { db, app, cookie } = await setup();
  createUser(db, { email: 'taken@x.x', passwordHash: 'h', displayName: 'Taken' });
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ email: 'taken@x.x' }),
  });
  const body = await r.json();
  assert.equal(body.user, undefined);
  assert.equal(body.passwordHash, undefined);
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

test('POST /api/me/password: success + login with new password works', async () => {
  const { app, cookie } = await setup();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ currentPassword: 'p', newPassword: 'newhunter2' }),
  });
  assert.equal(r.status, 200);
  const r2 = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@a.a', password: 'newhunter2' }),
  });
  assert.equal(r2.status, 200);
  server.close();
});

test('POST /api/me/password: wrong currentPassword → 400', async () => {
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

test('POST /api/me/password: newPassword too short → 400', async () => {
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

test('GET /api/me/competitions: returns competitions where user is a member', async () => {
  const { db, app, userId, cookie } = await setup();
  insertCompetition(db, { slug: 'c1', title: 'C1', type: 'native', visibility: 'public' });
  insertCompetition(db, { slug: 'c2', title: 'C2', type: 'native', visibility: 'public' });
  joinCompetition(db, 'c1', userId);
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/competitions`, { headers: { cookie } }).then(
    (x) => x.json()
  );
  assert.equal(r.competitions.length, 1);
  assert.equal(r.competitions[0].slug, 'c1');
  server.close();
});

test('GET /api/me/competitions: includes totalPoints + place for native with scored submissions', async () => {
  const { db, app, userId, cookie } = await setup();
  insertCompetition(db, { slug: 'c1', title: 'C1', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, {
    competitionSlug: 'c1',
    slug: 't',
    title: 'T',
    baselineScorePublic: 0,
    authorScorePublic: 1,
  });
  joinCompetition(db, 'c1', userId);
  const s = insertSubmission(db, {
    taskId: t.id,
    userId,
    originalFilename: 'sub',
    sizeBytes: 1,
    sha256: 'x',
    path: '/x',
  });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: 0.7, pointsPublic: 70, log: '', durationMs: 1 });
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/competitions`, { headers: { cookie } }).then(
    (x) => x.json()
  );
  const c = r.competitions[0];
  assert.equal(c.totalPoints, 70);
  assert.equal(c.place, 1);
  server.close();
});

test('GET /api/me/submissions: returns all user submissions across native tasks', async () => {
  const { db, app, userId, cookie } = await setup();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  insertSubmission(db, {
    taskId: t.id,
    userId,
    originalFilename: 'a',
    sizeBytes: 1,
    sha256: 'x',
    path: '/a',
  });
  insertSubmission(db, {
    taskId: t.id,
    userId,
    originalFilename: 'b',
    sizeBytes: 1,
    sha256: 'y',
    path: '/b',
  });
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/me/submissions`, { headers: { cookie } }).then(
    (x) => x.json()
  );
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
    insertSubmission(db, {
      taskId: t.id,
      userId,
      originalFilename: String(i),
      sizeBytes: 1,
      sha256: 'x',
      path: '/x',
    });
  }
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(
    `http://127.0.0.1:${port}/api/me/submissions?limit=2&offset=1`,
    { headers: { cookie } }
  ).then((x) => x.json());
  assert.equal(r.submissions.length, 2);
  server.close();
});
