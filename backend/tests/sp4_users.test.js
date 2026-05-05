import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import {
  createUser,
  findUserById,
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

test('updateUserPassword: смена пароля проверяется через verifyPassword', async () => {
  const db = freshDb();
  const u = createUser(db, { email: 'a@a.a', passwordHash: await hashPassword('old'), displayName: 'A' });
  updateUserPassword(db, u.id, await hashPassword('new'));
  const got = findUserById(db, u.id);
  assert.equal(await verifyPassword('new', got.passwordHash), true);
  assert.equal(await verifyPassword('old', got.passwordHash), false);
});
