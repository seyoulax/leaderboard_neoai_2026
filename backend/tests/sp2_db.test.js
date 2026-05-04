import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

function freshDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

test('migration 0002: applied after 0001', () => {
  const db = freshDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((r) => r.version), [1, 2]);
});

test('migration 0002: visibility column on competitions with check', () => {
  const db = freshDb();
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('a', 'A', 'kaggle')").run();
  const row = db.prepare("SELECT visibility FROM competitions WHERE slug='a'").get();
  assert.equal(row.visibility, 'public');
  assert.throws(
    () => db.prepare("INSERT INTO competitions (slug, title, type, visibility) VALUES ('b','B','kaggle','bogus')").run(),
    /CHECK/i
  );
});

test('migration 0002: legacy visible=0 → visibility=unlisted', () => {
  // Manually replay 0001 then insert legacy row then apply 0002 to verify the UPDATE works.
  const db = new Database(':memory:');
  db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)");
  const sql0001 = fs.readFileSync(path.join(MIG_DIR, '0001_init.sql'), 'utf8');
  db.exec(sql0001);
  db.prepare('INSERT INTO schema_migrations (version) VALUES (1)').run();
  db.prepare("INSERT INTO competitions (slug, title, type, visible) VALUES ('hidden','H','kaggle',0)").run();
  const sql0002 = fs.readFileSync(path.join(MIG_DIR, '0002_native_tasks.sql'), 'utf8');
  db.exec(sql0002);
  db.prepare('INSERT INTO schema_migrations (version) VALUES (2)').run();
  const row = db.prepare("SELECT visibility FROM competitions WHERE slug='hidden'").get();
  assert.equal(row.visibility, 'unlisted');
});

test('migration 0002: native_tasks + native_task_files exist with FKs', () => {
  const db = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(tables.includes('native_tasks'));
  assert.ok(tables.includes('native_task_files'));
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  db.prepare(`INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't1', 'T1')`).run();
  assert.throws(
    () => db.prepare(`INSERT INTO native_tasks (competition_slug, slug, title) VALUES ('c', 't1', 'dup')`).run(),
    /UNIQUE/i
  );
});
