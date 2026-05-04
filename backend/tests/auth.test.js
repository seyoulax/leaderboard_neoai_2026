import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import Database from 'better-sqlite3';
import { hashPassword, verifyPassword } from '../src/auth/bcrypt.js';
import {
  SESSION_COOKIE,
  buildSessionCookie,
  buildClearCookie,
  getCookieFromReq,
  sessionTtlMs,
} from '../src/auth/sessions.js';
import { makeRateLimiter } from '../src/auth/rateLimit.js';
import { loadUser, requireAuth, requireAdmin } from '../src/auth/middleware.js';
import { runMigrations } from '../src/db/index.js';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { createAuthRouter } from '../src/routes/auth.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

// ─── bcrypt ──────────────────────────────────────────────────────

test('bcrypt: hash → verify happy path', async () => {
  const hash = await hashPassword('hunter2');
  assert.notEqual(hash, 'hunter2');
  assert.equal(await verifyPassword('hunter2', hash), true);
});

test('bcrypt: verify rejects wrong password', async () => {
  const hash = await hashPassword('hunter2');
  assert.equal(await verifyPassword('wrong', hash), false);
});

// ─── session cookie helpers ──────────────────────────────────────

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

// ─── rate limit ──────────────────────────────────────────────────

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

// ─── middleware ──────────────────────────────────────────────────

function makeMiddlewareApp(db) {
  const app = express();
  app.use(loadUser({ db }));
  app.get('/anon', (req, res) => res.json({ user: req.user || null }));
  app.get('/protected', requireAuth, (req, res) => res.json({ user: req.user }));
  app.get('/admin', requireAdmin({ adminToken: 'shared-token' }), (req, res) =>
    res.json({ ok: true })
  );
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  try {
    await fn(server.address().port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('middleware.loadUser: anonymous → req.user = null', async () => {
  const db = freshDb();
  const app = makeMiddlewareApp(db);
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/anon`);
    const json = await r.json();
    assert.equal(json.user, null);
  });
});

test('middleware.loadUser: valid cookie → req.user populated', async () => {
  const db = freshDb();
  const u = createUser(db, {
    email: 'a@a.a',
    passwordHash: await hashPassword('p'),
    displayName: 'A',
  });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const app = makeMiddlewareApp(db);
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/protected`, {
      headers: { cookie: `${SESSION_COOKIE}=${sess.id}` },
    });
    const json = await r.json();
    assert.equal(json.user.id, u.id);
  });
});

test('middleware.requireAuth: 401 without session', async () => {
  const db = freshDb();
  const app = makeMiddlewareApp(db);
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/protected`);
    assert.equal(r.status, 401);
  });
});

test('middleware.requireAdmin: admin session passes', async () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  db.prepare("UPDATE users SET role='admin' WHERE id = ?").run(u.id);
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const app = makeMiddlewareApp(db);
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/admin`, {
      headers: { cookie: `${SESSION_COOKIE}=${sess.id}` },
    });
    assert.equal(r.status, 200);
  });
});

test('middleware.requireAdmin: x-admin-token fallback', async () => {
  const db = freshDb();
  const app = makeMiddlewareApp(db);
  await withServer(app, async (port) => {
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
  });
});

// ─── auth routes (integration) ───────────────────────────────────

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
  await withServer(app, async (port) => {
    const base = `http://127.0.0.1:${port}`;
    const reg = await fetchJson(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@a.a', password: 'hunter2hunter2', displayName: 'A' }),
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
  });
});

test('auth routes: register validation', async () => {
  const db = freshDb();
  const app = makeAuthApp(db);
  await withServer(app, async (port) => {
    const r = await fetchJson(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bad', password: 'short', displayName: '' }),
    });
    assert.equal(r.status, 400);
  });
});

test('auth routes: login wrong password', async () => {
  const db = freshDb();
  const app = makeAuthApp(db);
  await withServer(app, async (port) => {
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
  });
});

test('auth routes: register duplicate email returns 400', async () => {
  const db = freshDb();
  const app = makeAuthApp(db);
  await withServer(app, async (port) => {
    const body = JSON.stringify({ email: 'a@a.a', password: 'hunter2hunter2', displayName: 'A' });
    const a = await fetchJson(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(a.status, 200);
    const b = await fetchJson(`http://127.0.0.1:${port}/api/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(b.status, 400);
  });
});
