import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import {
  createUser,
  findUserById,
  updateKaggleId,
  updateUserProfile,
  updateUserPassword,
} from '../src/db/usersRepo.js';
import { hashPassword, verifyPassword } from '../src/auth/bcrypt.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

test('updateUserProfile: меняет displayName/email/kaggleId', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'old' });
  updateUserProfile(db, u.id, { email: 'b@b.b', displayName: 'B', kaggleId: 'NEW' });
  const got = findUserById(db, u.id);
  assert.equal(got.email, 'b@b.b');
  assert.equal(got.displayName, 'B');
  assert.equal(got.kaggleId, 'new');
});

test('updateUserProfile: partial update', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'k' });
  updateUserProfile(db, u.id, { displayName: 'NEW' });
  const got = findUserById(db, u.id);
  assert.equal(got.email, 'a@a.a');
  assert.equal(got.displayName, 'NEW');
  assert.equal(got.kaggleId, 'k');
});

test('updateUserProfile: kaggleId=null clears', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: 'k' });
  updateUserProfile(db, u.id, { kaggleId: null });
  assert.equal(findUserById(db, u.id).kaggleId, null);
});

test('updateUserProfile: email collision throws', () => {
  const db = freshDb();
  createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const u = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'B' });
  assert.throws(() => updateUserProfile(db, u.id, { email: 'a@a.a' }), /UNIQUE/i);
});

test('createUser normalizes email and kaggleId (trim + lowercase)', () => {
  const db = freshDb();
  const u = createUser(db, { email: '  Foo@BAR.com  ', passwordHash: 'h', displayName: 'A', kaggleId: '  Bob  ' });
  assert.equal(u.email, 'foo@bar.com');
  assert.equal(u.kaggleId, 'bob');
});

test('createUser kaggleId="   " is treated as null', () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A', kaggleId: '   ' });
  assert.equal(u.kaggleId, null);
});

test('email + kaggleId normalization is consistent across createUser / updateKaggleId / updateUserProfile', () => {
  const db = freshDb();
  // createUser path
  const u1 = createUser(db, { email: '  Foo@BAR.com  ', passwordHash: 'h', displayName: 'A', kaggleId: '  Bob ' });
  assert.equal(u1.email, 'foo@bar.com');
  assert.equal(u1.kaggleId, 'bob');

  // updateKaggleId path
  const u2 = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'B' });
  updateKaggleId(db, u2.id, '  Carol  ');
  assert.equal(findUserById(db, u2.id).kaggleId, 'carol');
  updateKaggleId(db, u2.id, '   ');
  assert.equal(findUserById(db, u2.id).kaggleId, null);

  // updateUserProfile path
  const u3 = createUser(db, { email: 'c@c.c', passwordHash: 'h', displayName: 'C' });
  updateUserProfile(db, u3.id, { email: '  Dan@DAN.com ', kaggleId: '  Dave  ' });
  const got = findUserById(db, u3.id);
  assert.equal(got.email, 'dan@dan.com');
  assert.equal(got.kaggleId, 'dave');
});

test('updateUserPassword: смена пароля проверяется через verifyPassword', async () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('old'), displayName: 'A' });
  updateUserPassword(db, u.id, await hashPassword('new'));
  const got = findUserById(db, u.id);
  assert.equal(await verifyPassword('new', got.passwordHash), true);
  assert.equal(await verifyPassword('old', got.passwordHash), false);
});
