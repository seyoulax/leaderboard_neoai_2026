import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { makeSnapshotCache } from '../src/scoring/snapshotCache.js';
import { runMigrations } from '../src/db/index.js';
import { createApp, bootstrapForTests } from '../src/app.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import { insertNativeTask } from '../src/db/nativeTasksRepo.js';
import { insertSubmission, pickAndMarkScoring, markScored } from '../src/db/submissionsRepo.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function startApp(app) {
  return new Promise((r) => { const s = app.listen(0, () => r(s)); });
}

function scoreSub(db, taskId, userId, points) {
  const s = insertSubmission(db, {
    taskId, userId,
    originalFilename: 'sub',
    sizeBytes: 1,
    sha256: `${taskId}-${userId}-${points}-${Math.random()}`,
    path: '/x',
  });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: points / 100, pointsPublic: points, log: '', durationMs: 1 });
  return s.id;
}

test('snapshotCache: first annotate returns deltas as null', () => {
  const cache = makeSnapshotCache();
  const fresh = {
    overall: [{ participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } }],
    byTask: { t: { entries: [{ participantKey: 'user:1', points: 100 }] } },
  };
  const annotated = cache.annotate('c', fresh);
  assert.equal(annotated.overall[0].previousTotalPoints, null);
  assert.equal(annotated.overall[0].tasks.t.previousPoints, null);
  assert.equal(annotated.byTask.t.entries[0].previousPoints, null);
});

test('snapshotCache: second annotate fills deltas from first', () => {
  const cache = makeSnapshotCache();
  cache.annotate('c', {
    overall: [{ participantKey: 'user:1', totalPoints: 80, tasks: { t: { points: 80 } } }],
    byTask: { t: { entries: [{ participantKey: 'user:1', points: 80 }] } },
  });
  const second = cache.annotate('c', {
    overall: [{ participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } }],
    byTask: { t: { entries: [{ participantKey: 'user:1', points: 100 }] } },
  });
  assert.equal(second.overall[0].previousTotalPoints, 80);
  assert.equal(second.overall[0].tasks.t.previousPoints, 80);
  assert.equal(second.byTask.t.entries[0].previousPoints, 80);
});

test('snapshotCache: new participant in second snapshot has null prev', () => {
  const cache = makeSnapshotCache();
  cache.annotate('c', {
    overall: [{ participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } }],
    byTask: { t: { entries: [{ participantKey: 'user:1', points: 100 }] } },
  });
  const second = cache.annotate('c', {
    overall: [
      { participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } },
      { participantKey: 'user:2', totalPoints: 90, tasks: { t: { points: 90 } } },
    ],
    byTask: { t: { entries: [
      { participantKey: 'user:1', points: 100 },
      { participantKey: 'user:2', points: 90 },
    ] } },
  });
  const newUser = second.overall.find((e) => e.participantKey === 'user:2');
  assert.equal(newUser.previousTotalPoints, null);
  const newUserTaskEntry = second.byTask.t.entries.find((e) => e.participantKey === 'user:2');
  assert.equal(newUserTaskEntry.previousPoints, null);
});

test('snapshotCache: per-competition isolation', () => {
  const cache = makeSnapshotCache();
  cache.annotate('c1', { overall: [{ participantKey: 'user:1', totalPoints: 50, tasks: {} }], byTask: {} });
  cache.annotate('c2', { overall: [{ participantKey: 'user:1', totalPoints: 70, tasks: {} }], byTask: {} });
  const second = cache.annotate('c1', { overall: [{ participantKey: 'user:1', totalPoints: 60, tasks: {} }], byTask: {} });
  assert.equal(second.overall[0].previousTotalPoints, 50);
});

test('snapshotCache: get returns last annotated snapshot', () => {
  const cache = makeSnapshotCache();
  assert.equal(cache.get('c'), null);
  const fresh = { overall: [{ participantKey: 'user:1', totalPoints: 100, tasks: {} }], byTask: {} };
  cache.annotate('c', fresh);
  const stored = cache.get('c');
  assert.ok(stored);
  assert.equal(stored.overall[0].totalPoints, 100);
});

test('snapshotCache: does not mutate input', () => {
  const cache = makeSnapshotCache();
  const fresh = { overall: [{ participantKey: 'user:1', totalPoints: 100, tasks: { t: { points: 100 } } }], byTask: { t: { entries: [{ participantKey: 'user:1', points: 100 }] } } };
  cache.annotate('c', fresh);
  assert.equal('previousTotalPoints' in fresh.overall[0], false);
  assert.equal('previousPoints' in fresh.overall[0].tasks.t, false);
});

test('leaderboard endpoint: native cold start uses snapshotCache (deltas null on first request)', async () => {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'Alice' });
  scoreSub(db, t.id, u.id, 50);
  const app = createApp({ db });
  await bootstrapForTests();
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/leaderboard`).then((x) => x.json());
  assert.equal(r.overall.length, 1);
  assert.equal(r.overall[0].previousTotalPoints, null);
  assert.equal(r.byTask.t.entries[0].previousPoints, null);
  assert.ok(Array.isArray(r.tasks));
  // Shape contract — keys must be present
  for (const k of ['overall', 'byTask', 'privateOverall', 'privateByTask', 'privateTaskSlugs',
                   'oursOverall', 'oursByTask', 'oursPrivateOverall', 'oursPrivateByTask',
                   'errors', 'tasks', 'updatedAt']) {
    assert.ok(k in r, `missing key '${k}'`);
  }
  server.close();
});

test('worker exports setOnScoredCallback (wiring contract)', async () => {
  const { setOnScoredCallback } = await import('../src/scoring/worker.js');
  assert.equal(typeof setOnScoredCallback, 'function');
  // No-op call should not throw
  setOnScoredCallback(null);
});
