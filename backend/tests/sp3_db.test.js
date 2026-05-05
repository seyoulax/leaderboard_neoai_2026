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
  assert.deepEqual(versions.map((r) => r.version), [1, 2, 3, 4]);
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
