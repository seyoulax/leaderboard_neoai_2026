import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  setUserRole,
  updateKaggleId,
  countAdmins,
} from '../src/db/usersRepo.js';
import {
  createSession,
  findSessionWithUser,
  deleteSession,
  cleanupExpired,
  touchSessionExpiry,
} from '../src/db/sessionsRepo.js';
import {
  insertCompetition,
  upsertCompetition,
  listActiveCompetitions,
  listVisibleCompetitions,
  getCompetition,
  softDeleteCompetition,
  bulkReplaceCompetitions,
} from '../src/db/competitionsRepo.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

// ─── runMigrations ───────────────────────────────────────────────

test('runMigrations: applies 0001_init on empty DB', () => {
  const db = freshDb();
  const row = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  assert.deepEqual(row, [{ version: 1 }, { version: 2 }, { version: 3 }]);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes('users'));
  assert.ok(tables.includes('sessions'));
  assert.ok(tables.includes('competitions'));
  assert.ok(tables.includes('competition_members'));
});

test('runMigrations: idempotent (second call no-op)', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  runMigrations(db);
  const versions = db.prepare('SELECT version FROM schema_migrations').all();
  assert.equal(versions.length, 3);
});

// ─── usersRepo ───────────────────────────────────────────────────

test('usersRepo.createUser + findUserByEmail (case-insensitive)', () => {
  const db = freshDb();
  const u = createUser(db, {
    email: 'Foo@Bar.com',
    passwordHash: 'h',
    displayName: 'Foo',
    kaggleId: null,
  });
  assert.equal(u.role, 'participant');
  assert.equal(u.email, 'Foo@Bar.com');
  const found = findUserByEmail(db, 'foo@bar.com');
  assert.equal(found.id, u.id);
});

test('usersRepo.createUser: duplicate email throws', () => {
  const db = freshDb();
  createUser(db, { email: 'x@y.z', passwordHash: 'h', displayName: 'A' });
  assert.throws(
    () => createUser(db, { email: 'X@Y.Z', passwordHash: 'h', displayName: 'B' }),
    /UNIQUE/i
  );
});

test('usersRepo.createUser: duplicate kaggleId throws, null ok', () => {
  const db = freshDb();
  createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'kid1' });
  createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'B', kaggleId: null });
  createUser(db, { email: 'c@c.c', passwordHash: 'h', displayName: 'C', kaggleId: null });
  assert.throws(
    () => createUser(db, { email: 'd@d.d', passwordHash: 'h', displayName: 'D', kaggleId: 'kid1' }),
    /UNIQUE/i
  );
});

test('usersRepo.setUserRole + findUserById', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  setUserRole(db, u.id, 'admin');
  assert.equal(findUserById(db, u.id).role, 'admin');
});

test('usersRepo.updateKaggleId lowercases', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  updateKaggleId(db, u.id, 'KaggleUSER');
  assert.equal(findUserById(db, u.id).kaggleId, 'kaggleuser');
});

test('usersRepo.countAdmins', () => {
  const db = freshDb();
  assert.equal(countAdmins(db), 0);
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  setUserRole(db, u.id, 'admin');
  assert.equal(countAdmins(db), 1);
});

// ─── sessionsRepo ────────────────────────────────────────────────

test('sessionsRepo: create → findWithUser → delete', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  assert.ok(sess.id);
  assert.ok(sess.expiresAt);
  const got = findSessionWithUser(db, sess.id);
  assert.equal(got.user.id, u.id);
  assert.equal(got.user.email, 'a@a.a');
  deleteSession(db, sess.id);
  assert.equal(findSessionWithUser(db, sess.id), null);
});

test('sessionsRepo.findSessionWithUser: expired returns null', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: -1 });
  assert.equal(findSessionWithUser(db, sess.id), null);
});

test('sessionsRepo.cleanupExpired removes expired only', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const expired = createSession(db, { userId: u.id, ttlMs: -1 });
  const live = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const removed = cleanupExpired(db);
  assert.equal(removed, 1);
  assert.equal(findSessionWithUser(db, expired.id), null);
  assert.ok(findSessionWithUser(db, live.id));
});

test('sessionsRepo.touchSessionExpiry extends expiresAt', async () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const sess = createSession(db, { userId: u.id, ttlMs: 60_000 });
  const before = sess.expiresAt;
  await new Promise((r) => setTimeout(r, 5));
  touchSessionExpiry(db, sess.id, 86_400_000);
  const got = findSessionWithUser(db, sess.id);
  assert.ok(got.expiresAt > before);
});

// ─── competitionsRepo ────────────────────────────────────────────

test('competitionsRepo.insertCompetition + getCompetition', () => {
  const db = freshDb();
  const c = insertCompetition(db, {
    slug: 'foo',
    title: 'Foo',
    type: 'kaggle',
    visible: true,
    displayOrder: 0,
  });
  assert.equal(c.slug, 'foo');
  assert.equal(c.type, 'kaggle');
  assert.equal(c.visible, true);
  assert.equal(getCompetition(db, 'foo').title, 'Foo');
});

test('competitionsRepo.softDeleteCompetition hides from listActive', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  insertCompetition(db, { slug: 'b', title: 'B', type: 'native' });
  softDeleteCompetition(db, 'a');
  const active = listActiveCompetitions(db);
  assert.deepEqual(active.map((c) => c.slug), ['b']);
});

test('competitionsRepo.listVisibleCompetitions excludes invisible', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle', visible: true });
  insertCompetition(db, { slug: 'b', title: 'B', type: 'native', visible: false });
  assert.deepEqual(listVisibleCompetitions(db).map((c) => c.slug), ['a']);
});

test('competitionsRepo.bulkReplaceCompetitions: missing slugs → soft-deleted', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  insertCompetition(db, { slug: 'b', title: 'B', type: 'native' });
  bulkReplaceCompetitions(db, [
    { slug: 'a', title: 'A2', type: 'kaggle', visible: true, displayOrder: 1 },
    { slug: 'c', title: 'C', type: 'native', visible: true, displayOrder: 2 },
  ]);
  const active = listActiveCompetitions(db).map((c) => c.slug).sort();
  assert.deepEqual(active, ['a', 'c']);
  assert.equal(getCompetition(db, 'a').title, 'A2');
});

test('competitionsRepo.upsertCompetition writes new and updates existing', () => {
  const db = freshDb();
  upsertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  upsertCompetition(db, { slug: 'a', title: 'A2', type: 'kaggle' });
  const c = getCompetition(db, 'a');
  assert.equal(c.title, 'A2');
  assert.equal(c.type, 'kaggle');
});
