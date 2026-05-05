import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSnapshotCache } from '../src/scoring/snapshotCache.js';

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
