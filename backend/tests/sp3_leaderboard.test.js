import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import { insertNativeTask } from '../src/db/nativeTasksRepo.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertSubmission, pickAndMarkScoring, markScored } from '../src/db/submissionsRepo.js';
import { buildNativeLeaderboard } from '../src/scoring/nativeLeaderboard.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function seed(db) {
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t1 = insertNativeTask(db, {
    competitionSlug: 'c', slug: 't1', title: 'T1',
    baselineScorePublic: 0, authorScorePublic: 1,
  });
  const t2 = insertNativeTask(db, {
    competitionSlug: 'c', slug: 't2', title: 'T2',
    baselineScorePublic: 0, authorScorePublic: 1,
  });
  const u1 = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'Alice', kaggleId: 'alice' });
  const u2 = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'Bob', kaggleId: 'bob' });
  return { taskIds: [t1.id, t2.id], userIds: [u1.id, u2.id] };
}

function score(db, taskId, userId, points) {
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: '/x' });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: points / 100, pointsPublic: points, log: '', durationMs: 1 });
}

test('buildNativeLeaderboard: best per user per task, sum totalPoints', () => {
  const db = freshDb();
  const { taskIds: [t1, t2] } = seed(db);
  score(db, t1, 1, 70); score(db, t1, 1, 50); score(db, t1, 1, 80);
  score(db, t2, 1, 60);
  score(db, t1, 2, 90);

  const lb = buildNativeLeaderboard(db, 'c', 'public');
  const totals = lb.overall.map((e) => ({ name: e.nickname, total: e.totalPoints }));
  assert.deepEqual(totals.sort((a, b) => b.total - a.total), [
    { name: 'Alice', total: 140 },
    { name: 'Bob', total: 90 },
  ]);
  assert.equal(lb.byTask.t1.entries.length, 2);
  assert.equal(lb.byTask.t1.entries[0].nickname, 'Bob');
});

test('buildNativeLeaderboard: пустые сабмиты → пустой ответ', () => {
  const db = freshDb();
  seed(db);
  const lb = buildNativeLeaderboard(db, 'c', 'public');
  assert.equal(lb.overall.length, 0);
});

test('buildNativeLeaderboard: variant=private игнорирует submission без points_private', () => {
  const db = freshDb();
  const { taskIds: [t1] } = seed(db);
  const u = createUser(db, { email: 'x@x.x', passwordHash: 'h', displayName: 'X' });
  const s = insertSubmission(db, { taskId: t1, userId: u.id, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: 0.5, pointsPublic: 50, log: '', durationMs: 1 });
  const lb = buildNativeLeaderboard(db, 'c', 'private');
  assert.equal(lb.overall.length, 0);
});

test('GET /api/competitions/<native>/leaderboard returns 4 variants populated', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  const { taskIds: [t1, t2] } = seed(db);
  score(db, t1, 1, 70); score(db, t2, 1, 60);
  score(db, t1, 2, 90);
  const { createApp, bootstrapForTests } = await import('../src/app.js');
  const app = createApp({ db });
  await bootstrapForTests();
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/leaderboard`).then((x) => x.json());
  for (const key of ['overall', 'privateOverall', 'oursOverall', 'oursPrivateOverall', 'byTask', 'privateByTask', 'oursByTask', 'oursPrivateByTask']) {
    assert.ok(key in r, `missing ${key}`);
  }
  assert.equal(r.overall.length, 2);
  assert.equal(r.overall[0].nickname, 'Alice');
  assert.equal(r.privateOverall.length, 0);
  assert.equal(r.oursOverall.length, r.overall.length);
  server.close();
});
