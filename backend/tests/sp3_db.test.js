import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

test('migration 0004: applied after 0001+0002+0003', () => {
  const db = freshDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((r) => r.version), [1, 2, 3, 4, 5]);
});

test('migration 0004: native_tasks gets ground_truth_private_path column', () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(native_tasks)").all().map((c) => c.name);
  assert.ok(cols.includes('ground_truth_private_path'));
});

test('migration 0004: submissions table created with expected columns', () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(submissions)").all().map((c) => c.name);
  for (const expected of [
    'id', 'task_id', 'user_id', 'original_filename', 'size_bytes', 'sha256', 'path',
    'status', 'raw_score_public', 'raw_score_private', 'points_public', 'points_private',
    'attempts', 'error_message', 'log_excerpt', 'duration_ms',
    'started_at', 'scored_at', 'created_at',
  ]) {
    assert.ok(cols.includes(expected), `missing column: ${expected}`);
  }
});

test('migration 0004: status CHECK constraint', () => {
  const db = freshDb();
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  assert.throws(
    () => db.prepare(`INSERT INTO submissions
      (task_id, user_id, original_filename, size_bytes, sha256, path, status)
      VALUES (1, 1, 'x', 1, 'h', '/x', 'BOGUS')`).run(),
    /CHECK/i
  );
});

test('migration 0004: submissions FK cascade on task delete', () => {
  const db = freshDb();
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  db.prepare(`INSERT INTO submissions (task_id, user_id, original_filename, size_bytes, sha256, path)
              VALUES (1, 1, 'x', 1, 'h', '/x')`).run();
  db.prepare("DELETE FROM native_tasks WHERE id = 1").run();
  const left = db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
  assert.equal(left, 0);
});

// ─── nativeTasksRepo extension (Task 1.2) ───────────────────────

import { insertNativeTask, getNativeTask, updateNativeTask } from '../src/db/nativeTasksRepo.js';

function seedComp(db) {
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
}

test('nativeTasksRepo: groundTruthPrivatePath round-trip', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  updateNativeTask(db, 'c', 't', { groundTruthPrivatePath: '/abs/private.csv' });
  const got = getNativeTask(db, 'c', 't');
  assert.equal(got.groundTruthPrivatePath, '/abs/private.csv');
});

test('nativeTasksRepo: groundTruthPrivatePath defaults null on insert', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const got = getNativeTask(db, 'c', 't');
  assert.equal(got.groundTruthPrivatePath, null);
});

// ─── submissionsRepo (Task 1.3) ─────────────────────────────────

import {
  insertSubmission,
  getSubmission,
  listSubmissionsForUserTask,
  listSubmissionsForTask,
  countRecentSubmissions,
  pickAndMarkScoring,
  markScored,
  markFailed,
  markFailedRetry,
  recoverStale,
  resetSubmissionForRescore,
  resetAllForRescore,
  deleteSubmission,
} from '../src/db/submissionsRepo.js';

function seedTaskAndUser(db) {
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  const task = db.prepare("SELECT id FROM native_tasks WHERE slug='t'").get();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  const user = db.prepare("SELECT id FROM users WHERE email='a@a.a'").get();
  return { taskId: task.id, userId: user.id };
}

test('submissionsRepo.insert + getSubmission', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, {
    taskId, userId,
    originalFilename: 'sub.csv', sizeBytes: 100, sha256: 'h', path: '/abs/sub.csv',
  });
  assert.equal(s.status, 'pending');
  assert.equal(s.attempts, 0);
  const got = getSubmission(db, s.id);
  assert.equal(got.id, s.id);
});

test('submissionsRepo.pickAndMarkScoring: атомарность', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const a = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  const b = insertSubmission(db, { taskId, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  const first = pickAndMarkScoring(db);
  const second = pickAndMarkScoring(db);
  assert.equal(first.id, a.id);
  assert.equal(second.id, b.id);
  assert.equal(getSubmission(db, a.id).status, 'scoring');
  assert.equal(getSubmission(db, b.id).status, 'scoring');
  assert.ok(getSubmission(db, a.id).startedAt);
});

test('submissionsRepo.pickAndMarkScoring: возвращает null если pending нет', () => {
  const db = freshDb();
  seedTaskAndUser(db);
  assert.equal(pickAndMarkScoring(db), null);
});

test('submissionsRepo.markScored: обновляет points, status, scored_at', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markScored(db, s.id, {
    rawScorePublic: 0.85, rawScorePrivate: 0.83,
    pointsPublic: 70, pointsPrivate: 65,
    log: 'ok', durationMs: 500,
  });
  const got = getSubmission(db, s.id);
  assert.equal(got.status, 'scored');
  assert.equal(got.rawScorePublic, 0.85);
  assert.equal(got.pointsPrivate, 65);
  assert.ok(got.scoredAt);
});

test('submissionsRepo.markFailed: финальный fail, не возвращается воркером', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markFailed(db, s.id, { error: 'boom', log: 'err', durationMs: 100 });
  const got = getSubmission(db, s.id);
  assert.equal(got.status, 'failed');
  assert.equal(got.errorMessage, 'boom');
  assert.equal(pickAndMarkScoring(db), null);
});

test('submissionsRepo.markFailedRetry: возвращает в pending, attempts++', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markFailedRetry(db, s.id, { error: 'transient', log: '', durationMs: 100 });
  const got = getSubmission(db, s.id);
  assert.equal(got.status, 'pending');
  assert.equal(got.attempts, 1);
  assert.equal(pickAndMarkScoring(db).id, s.id);
});

test('submissionsRepo.recoverStale: возвращает старые scoring в pending', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  db.prepare("UPDATE submissions SET started_at = datetime('now', '-30 minutes') WHERE id = ?").run(s.id);
  const recovered = recoverStale(db);
  assert.equal(recovered, 1);
  assert.equal(getSubmission(db, s.id).status, 'pending');
  assert.equal(getSubmission(db, s.id).attempts, 1);
});

test('submissionsRepo.countRecentSubmissions: считает за 24h', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  insertSubmission(db, { taskId, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  db.prepare("UPDATE submissions SET created_at = datetime('now', '-25 hours') WHERE original_filename='b'").run();
  assert.equal(countRecentSubmissions(db, { userId, taskId, hours: 24 }), 1);
});

test('submissionsRepo.listSubmissionsForUserTask: DESC по created_at', async () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const a = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  await new Promise((r) => setTimeout(r, 5));
  const b = insertSubmission(db, { taskId, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  const list = listSubmissionsForUserTask(db, { userId, taskId });
  assert.equal(list[0].id, b.id);
  assert.equal(list[1].id, a.id);
});

test('submissionsRepo.resetSubmissionForRescore: обнуляет, возвращает в pending', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: 1, pointsPublic: 50, log: '', durationMs: 100 });
  resetSubmissionForRescore(db, s.id);
  const got = getSubmission(db, s.id);
  assert.equal(got.status, 'pending');
  assert.equal(got.rawScorePublic, null);
  assert.equal(got.pointsPublic, null);
  assert.equal(got.attempts, 0);
});

test('submissionsRepo.resetAllForRescore(taskId): сбрасывает все scored+failed', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const a = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  const b = insertSubmission(db, { taskId, userId, originalFilename: 'b', sizeBytes: 1, sha256: 'y', path: '/b' });
  pickAndMarkScoring(db); markScored(db, a.id, { rawScorePublic: 0.5, pointsPublic: 50, log: '', durationMs: 1 });
  pickAndMarkScoring(db); markFailed(db, b.id, { error: 'x', log: '', durationMs: 1 });
  const reset = resetAllForRescore(db, taskId);
  assert.equal(reset, 2);
  assert.equal(getSubmission(db, a.id).status, 'pending');
  assert.equal(getSubmission(db, b.id).status, 'pending');
});

test('submissionsRepo.deleteSubmission removes row', () => {
  const db = freshDb();
  const { taskId, userId } = seedTaskAndUser(db);
  const s = insertSubmission(db, { taskId, userId, originalFilename: 'a', sizeBytes: 1, sha256: 'x', path: '/a' });
  deleteSubmission(db, s.id);
  assert.equal(getSubmission(db, s.id), null);
});
