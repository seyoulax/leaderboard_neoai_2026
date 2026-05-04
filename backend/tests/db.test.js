import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';

test('runMigrations: applies 0001_init on empty DB', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const row = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  assert.deepEqual(row, [{ version: 1 }]);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes('users'));
  assert.ok(tables.includes('sessions'));
  assert.ok(tables.includes('competitions'));
  assert.ok(tables.includes('competition_members'));
});

test('runMigrations: idempotent (second call no-op)', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  runMigrations(db);
  const versions = db.prepare('SELECT version FROM schema_migrations').all();
  assert.equal(versions.length, 1);
});
