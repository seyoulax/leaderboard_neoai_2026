import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp, bootstrapForTests } from '../src/app.js';
import { createUser } from '../src/db/usersRepo.js';
import { createSession } from '../src/db/sessionsRepo.js';
import { hashPassword } from '../src/auth/bcrypt.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';

function fresh() {
  const db = new Database(':memory:');
  runMigrations(db);
  process.env.ADMIN_TOKEN = 'shared';
  const app = createApp({ db });
  return { db, app };
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

test('admin/competitions: token fallback works', async () => {
  const { app } = fresh();
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
      headers: { 'x-admin-token': 'shared' },
    });
    assert.equal(r.status, 200);
  });
});

test('admin/competitions: 401 без auth', async () => {
  const { app } = fresh();
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`);
    assert.equal(r.status, 401);
  });
});

test('admin/competitions: admin-сессия пускает; participant — 403', async () => {
  const { db, app } = fresh();
  const adminU = createUser(db, {
    email: 'a@a.a', passwordHash: await hashPassword('p'), displayName: 'A',
  });
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminU.id);
  const adminSess = createSession(db, { userId: adminU.id, ttlMs: 60_000 });

  const partU = createUser(db, {
    email: 'b@b.b', passwordHash: await hashPassword('p'), displayName: 'B',
  });
  const partSess = createSession(db, { userId: partU.id, ttlMs: 60_000 });

  await withServer(app, async (port) => {
    const okR = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
      headers: { cookie: `${SESSION_COOKIE}=${adminSess.id}` },
    });
    assert.equal(okR.status, 200);
    const forbR = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
      headers: { cookie: `${SESSION_COOKIE}=${partSess.id}` },
    });
    assert.equal(forbR.status, 403);
  });
});

test('admin/competitions: POST создаёт native; GET /api/competitions показывает только visible', async () => {
  const { app } = fresh();
  await bootstrapForTests();
  await withServer(app, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'shared' },
      body: JSON.stringify({
        competition: { slug: 'native-1', title: 'Native One', type: 'native', visible: true },
      }),
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.competition.type, 'native');
    const pub = await fetch(`http://127.0.0.1:${port}/api/competitions`).then((x) => x.json());
    assert.ok(pub.competitions.some((c) => c.slug === 'native-1'));
  });
});
