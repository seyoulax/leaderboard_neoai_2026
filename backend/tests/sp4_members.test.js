import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import {
  joinCompetition,
  leaveCompetition,
  isMember,
  getMembership,
  listMembershipsForUser,
} from '../src/db/membersRepo.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }

function seed(db) {
  insertCompetition(db, { slug: 'c1', title: 'C1', type: 'native', visibility: 'public' });
  insertCompetition(db, { slug: 'c2', title: 'C2', type: 'native', visibility: 'public' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  return u.id;
}

test('joinCompetition: idempotent (INSERT IGNORE)', () => {
  const db = freshDb();
  const userId = seed(db);
  const r1 = joinCompetition(db, 'c1', userId);
  assert.equal(r1.alreadyMember, false);
  const r2 = joinCompetition(db, 'c1', userId);
  assert.equal(r2.alreadyMember, true);
  assert.equal(isMember(db, 'c1', userId), true);
});

test('leaveCompetition: deletes row', () => {
  const db = freshDb();
  const userId = seed(db);
  joinCompetition(db, 'c1', userId);
  assert.equal(isMember(db, 'c1', userId), true);
  leaveCompetition(db, 'c1', userId);
  assert.equal(isMember(db, 'c1', userId), false);
});

test('listMembershipsForUser: возвращает с joinedAt', () => {
  const db = freshDb();
  const userId = seed(db);
  joinCompetition(db, 'c1', userId);
  joinCompetition(db, 'c2', userId);
  const list = listMembershipsForUser(db, userId);
  assert.equal(list.length, 2);
  assert.ok(list[0].joinedAt);
  assert.ok(list.find((m) => m.competitionSlug === 'c1'));
  assert.ok(list.find((m) => m.competitionSlug === 'c2'));
});

test('getMembership: returns row when member, null otherwise', () => {
  const db = freshDb();
  const userId = seed(db);
  assert.equal(getMembership(db, 'c1', userId), null);
  joinCompetition(db, 'c1', userId);
  const m = getMembership(db, 'c1', userId);
  assert.equal(m.competitionSlug, 'c1');
  assert.equal(m.userId, userId);
  assert.ok(m.joinedAt);
});
