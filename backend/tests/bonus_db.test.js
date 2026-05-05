import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import {
  joinCompetition,
  getMembership,
  listMembershipsForUser,
  setBonusPoints,
  getBonusPointsByUserId,
} from '../src/db/membersRepo.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function seed(db) {
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  return u.id;
}

test('migration 0006: applied after 0001-0005', () => {
  const db = freshDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((r) => r.version), [1, 2, 3, 4, 5, 6]);
});

test('migration 0006: competition_members.bonus_points exists with default 0', () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(competition_members)").all();
  const c = cols.find((c) => c.name === 'bonus_points');
  assert.ok(c, 'bonus_points column missing');
  assert.equal(c.dflt_value, '0');
  assert.equal(c.notnull, 1);
});

test('joinCompetition: row gets default bonusPoints=0', () => {
  const db = freshDb();
  const userId = seed(db);
  joinCompetition(db, 'c', userId);
  const m = getMembership(db, 'c', userId);
  assert.equal(m.bonusPoints, 0);
});

test('listMembershipsForUser: includes bonusPoints field', () => {
  const db = freshDb();
  const userId = seed(db);
  joinCompetition(db, 'c', userId);
  const list = listMembershipsForUser(db, userId);
  assert.equal(list[0].bonusPoints, 0);
});

test('setBonusPoints: updates existing membership row', () => {
  const db = freshDb();
  const userId = seed(db);
  joinCompetition(db, 'c', userId);
  setBonusPoints(db, 'c', userId, 12.5);
  assert.equal(getMembership(db, 'c', userId).bonusPoints, 12.5);
});

test('setBonusPoints: creates row when missing (admin grants bonus pre-join)', () => {
  const db = freshDb();
  const userId = seed(db);
  // No joinCompetition call.
  setBonusPoints(db, 'c', userId, 7);
  const m = getMembership(db, 'c', userId);
  assert.ok(m, 'membership row should be created');
  assert.equal(m.bonusPoints, 7);
});

test('setBonusPoints: rejects non-finite numbers', () => {
  const db = freshDb();
  const userId = seed(db);
  joinCompetition(db, 'c', userId);
  assert.throws(() => setBonusPoints(db, 'c', userId, NaN), /finite/);
  assert.throws(() => setBonusPoints(db, 'c', userId, Infinity), /finite/);
  assert.throws(() => setBonusPoints(db, 'c', userId, '5'), /finite/);
});

test('getBonusPointsByUserId: returns Map of userId → bonus_points', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const u1 = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const u2 = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'B' });
  const u3 = createUser(db, { email: 'c@c.c', passwordHash: 'h', displayName: 'C' });
  joinCompetition(db, 'c', u1.id);
  joinCompetition(db, 'c', u2.id);
  // u3 not a member
  setBonusPoints(db, 'c', u1.id, 5);
  setBonusPoints(db, 'c', u2.id, 0);
  const m = getBonusPointsByUserId(db, 'c');
  assert.equal(m instanceof Map, true);
  assert.equal(m.get(u1.id), 5);
  assert.equal(m.get(u2.id), 0);
  assert.equal(m.has(u3.id), false);
});
