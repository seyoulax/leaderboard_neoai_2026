import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { listActiveCompetitions } from '../src/db/competitionsRepo.js';
import { migrateCompetitionsJsonToDb } from '../src/dataMigration/competitionsJsonToDb.js';

function makeTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sp1-mig-'));
}

test('competitionsJsonToDb: imports legacy json + backs up + deletes', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const dataDir = makeTempDataDir();
  const jsonFile = path.join(dataDir, 'competitions.json');
  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      [
        { slug: 'neoai-2026', title: 'NEOAI', subtitle: 'Sub', order: 0, visible: true },
        { slug: 'foo', title: 'Foo', visible: false },
      ],
      null,
      2
    )
  );
  const result = migrateCompetitionsJsonToDb({ db, dataDir });
  assert.equal(result.migrated, true);
  assert.equal(result.count, 2);
  assert.ok(result.backupFile && fs.existsSync(result.backupFile));
  assert.equal(fs.existsSync(jsonFile), false);
  const list = listActiveCompetitions(db).map((c) => c.slug).sort();
  assert.deepEqual(list, ['foo', 'neoai-2026']);
  const nat = listActiveCompetitions(db).find((c) => c.slug === 'neoai-2026');
  assert.equal(nat.type, 'kaggle');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('competitionsJsonToDb: idempotent — runs once even if file reappears', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const dataDir = makeTempDataDir();
  fs.writeFileSync(
    path.join(dataDir, 'competitions.json'),
    JSON.stringify([{ slug: 'a', title: 'A' }])
  );
  migrateCompetitionsJsonToDb({ db, dataDir });
  fs.writeFileSync(
    path.join(dataDir, 'competitions.json'),
    JSON.stringify([{ slug: 'b', title: 'B' }])
  );
  const result = migrateCompetitionsJsonToDb({ db, dataDir });
  assert.equal(result.migrated, false);
  const list = listActiveCompetitions(db).map((c) => c.slug);
  assert.deepEqual(list, ['a']);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('competitionsJsonToDb: no-op when no json file exists', () => {
  const db = new Database(':memory:');
  runMigrations(db);
  const dataDir = makeTempDataDir();
  const result = migrateCompetitionsJsonToDb({ db, dataDir });
  assert.equal(result.migrated, false);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
