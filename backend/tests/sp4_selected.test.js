import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

test('migration 0005: applied after 0001-0004', () => {
  const db = freshDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((r) => r.version), [1, 2, 3, 4, 5]);
});

test('migration 0005: submissions.selected column exists with default 0', () => {
  const db = freshDb();
  const cols = db.prepare("PRAGMA table_info(submissions)").all();
  const sel = cols.find((c) => c.name === 'selected');
  assert.ok(sel, 'selected column missing');
  assert.equal(sel.dflt_value, '0');
  assert.equal(sel.notnull, 1);
});

test('migration 0005: selected CHECK constraint', () => {
  const db = freshDb();
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  assert.throws(
    () => db.prepare(`INSERT INTO submissions
      (task_id, user_id, original_filename, size_bytes, sha256, path, selected)
      VALUES (1, 1, 'x', 1, 'h', '/x', 5)`).run(),
    /CHECK/i
  );
});

test('migration 0005: existing submission rows get selected=0', () => {
  // Симулируем БД с pre-0005 schema, потом 0005 накатывается. Применяем все миграции
  // кроме 0005 руками, вставляем submission, потом применяем 0005.
  const db = new Database(':memory:');
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)");
  const allFiles = fs.readdirSync(MIG_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const pre = allFiles.filter((f) => !f.startsWith('0005_'));
  for (const f of pre) {
    const version = Number(f.match(/^(\d+)_/)[1]);
    db.exec(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  }
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare("INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't', 'T')").run();
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  db.prepare(`INSERT INTO submissions (task_id, user_id, original_filename, size_bytes, sha256, path)
              VALUES (1, 1, 'x', 1, 'h', '/x')`).run();
  const sql5 = fs.readFileSync(path.join(MIG_DIR, '0005_selected_and_indexes.sql'), 'utf8');
  db.exec(sql5);
  const got = db.prepare("SELECT selected FROM submissions WHERE id = 1").get();
  assert.equal(got.selected, 0);
});
