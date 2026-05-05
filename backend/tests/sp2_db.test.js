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
  assert.deepEqual(versions.map((r) => r.version), [1, 2, 3, 4]);
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

import {
  insertNativeTask,
  getNativeTask,
  listNativeTasks,
  updateNativeTask,
  softDeleteNativeTask,
} from '../src/db/nativeTasksRepo.js';

function seedComp(db, slug = 'c', type = 'native') {
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES (?, ?, ?)").run(slug, slug.toUpperCase(), type);
}

test('nativeTasksRepo.insertNativeTask + getNativeTask', () => {
  const db = freshDb();
  seedComp(db);
  const t = insertNativeTask(db, {
    competitionSlug: 'c',
    slug: 't1',
    title: 'T1',
    descriptionMd: '# Hi',
    higherIsBetter: true,
  });
  assert.equal(t.slug, 't1');
  assert.equal(t.descriptionMd, '# Hi');
  assert.equal(t.higherIsBetter, true);
  const got = getNativeTask(db, 'c', 't1');
  assert.equal(got.id, t.id);
});

test('nativeTasksRepo: scoring anchors round-trip', () => {
  const db = freshDb();
  seedComp(db);
  const t = insertNativeTask(db, {
    competitionSlug: 'c',
    slug: 't',
    title: 'T',
    baselineScorePublic: 0.5,
    authorScorePublic: 0.9,
    baselineScorePrivate: 0.4,
    authorScorePrivate: 0.85,
  });
  assert.equal(t.baselineScorePublic, 0.5);
  assert.equal(t.authorScorePublic, 0.9);
  assert.equal(t.baselineScorePrivate, 0.4);
  assert.equal(t.authorScorePrivate, 0.85);
});

test('nativeTasksRepo.listNativeTasks: hides soft-deleted', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 'a', title: 'A' });
  insertNativeTask(db, { competitionSlug: 'c', slug: 'b', title: 'B' });
  softDeleteNativeTask(db, 'c', 'a');
  const list = listNativeTasks(db, 'c').map((t) => t.slug);
  assert.deepEqual(list, ['b']);
});

test('nativeTasksRepo.updateNativeTask: partial update', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'old', descriptionMd: 'd' });
  updateNativeTask(db, 'c', 't', { title: 'new', descriptionMd: 'D2' });
  const got = getNativeTask(db, 'c', 't');
  assert.equal(got.title, 'new');
  assert.equal(got.descriptionMd, 'D2');
});

test('nativeTasksRepo.insertNativeTask: duplicate slug throws', () => {
  const db = freshDb();
  seedComp(db);
  insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  assert.throws(
    () => insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'D' }),
    /UNIQUE/i
  );
});

import {
  insertPendingFile,
  commitFilePath,
  getFileById,
  listFilesByTask,
  deleteFileById,
  updateFileMetadata,
} from '../src/db/nativeTaskFilesRepo.js';

import {
  insertCompetition,
  upsertCompetition,
  getCompetition,
  listVisibleCompetitions,
  searchPublicCompetitions,
} from '../src/db/competitionsRepo.js';

function seedTask(db) {
  seedComp(db);
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  return t;
}

test('files: insertPending → commitPath → list', () => {
  const db = freshDb();
  const task = seedTask(db);
  const row = insertPendingFile(db, {
    taskId: task.id,
    kind: 'dataset',
    displayName: 'train',
    description: '',
    originalFilename: 'train.csv',
    sizeBytes: 1024,
    sha256: 'abc',
  });
  assert.ok(row.id);
  commitFilePath(db, row.id, '/abs/path');
  const got = getFileById(db, row.id);
  assert.equal(got.path, '/abs/path');
  const list = listFilesByTask(db, task.id, 'dataset');
  assert.equal(list.length, 1);
});

test('files: kind filter', () => {
  const db = freshDb();
  const task = seedTask(db);
  const a = insertPendingFile(db, { taskId: task.id, kind: 'dataset', displayName: 'a', originalFilename: 'a', sizeBytes: 1, sha256: 'x' });
  commitFilePath(db, a.id, '/a');
  const b = insertPendingFile(db, { taskId: task.id, kind: 'artifact', displayName: 'b', originalFilename: 'b', sizeBytes: 1, sha256: 'y' });
  commitFilePath(db, b.id, '/b');
  assert.equal(listFilesByTask(db, task.id, 'dataset').length, 1);
  assert.equal(listFilesByTask(db, task.id, 'artifact').length, 1);
});

test('files: deleteById removes row', () => {
  const db = freshDb();
  const task = seedTask(db);
  const f = insertPendingFile(db, { taskId: task.id, kind: 'dataset', displayName: 'a', originalFilename: 'a', sizeBytes: 1, sha256: 'x' });
  commitFilePath(db, f.id, '/a');
  deleteFileById(db, f.id);
  assert.equal(getFileById(db, f.id), null);
});

test('files: updateMetadata changes display_name/description/order', () => {
  const db = freshDb();
  const task = seedTask(db);
  const f = insertPendingFile(db, { taskId: task.id, kind: 'dataset', displayName: 'a', originalFilename: 'a.csv', sizeBytes: 1, sha256: 'x' });
  commitFilePath(db, f.id, '/a');
  updateFileMetadata(db, f.id, { displayName: 'NEW', description: 'd', displayOrder: 5 });
  const got = getFileById(db, f.id);
  assert.equal(got.displayName, 'NEW');
  assert.equal(got.description, 'd');
  assert.equal(got.displayOrder, 5);
});

test('competitionsRepo.listVisibleCompetitions: только public + visible=1', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle', visibility: 'public', visible: true });
  insertCompetition(db, { slug: 'b', title: 'B', type: 'native', visibility: 'unlisted', visible: true });
  insertCompetition(db, { slug: 'c', title: 'C', type: 'kaggle', visibility: 'public', visible: false });
  const list = listVisibleCompetitions(db).map((c) => c.slug);
  assert.deepEqual(list, ['a']);
});

test('competitionsRepo.searchPublicCompetitions: case-insensitive LIKE по title', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'NEOAI 2026', type: 'kaggle', visibility: 'public' });
  insertCompetition(db, { slug: 'b', title: 'Kaggle Forces', type: 'kaggle', visibility: 'public' });
  insertCompetition(db, { slug: 'c', title: 'Hidden', type: 'native', visibility: 'unlisted' });
  assert.deepEqual(searchPublicCompetitions(db, 'neo').map((c) => c.slug), ['a']);
  assert.deepEqual(searchPublicCompetitions(db, 'KAGGLE').map((c) => c.slug), ['b']);
  assert.deepEqual(searchPublicCompetitions(db, 'hidden').map((c) => c.slug), []);
  assert.deepEqual(searchPublicCompetitions(db, '').map((c) => c.slug).sort(), ['a', 'b']);
});

test('competitionsRepo.upsertCompetition: type-lock — менять type существующего соревнования нельзя', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  assert.throws(
    () => upsertCompetition(db, { slug: 'a', title: 'A', type: 'native' }),
    /type/i
  );
});

// ─── theme (migration 0003) ──────────────────────────────────────

test('competitionsRepo: theme round-trip (accent + preset)', () => {
  const db = freshDb();
  insertCompetition(db, {
    slug: 'a', title: 'A', type: 'kaggle',
    theme: { accent: '#ff5500', preset: 'highlight-rising' },
  });
  const c = getCompetition(db, 'a');
  assert.deepEqual(c.theme, { accent: '#ff5500', preset: 'highlight-rising' });
});

test('competitionsRepo: theme=null persists as null', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle' });
  const c = getCompetition(db, 'a');
  assert.equal(c.theme, null);
});

test('competitionsRepo.upsertCompetition: theme can be cleared', () => {
  const db = freshDb();
  insertCompetition(db, {
    slug: 'a', title: 'A', type: 'kaggle',
    theme: { accent: '#abcdef', preset: 'minimal' },
  });
  upsertCompetition(db, { slug: 'a', title: 'A', type: 'kaggle', theme: null });
  assert.equal(getCompetition(db, 'a').theme, null);
});

test('competitionsRepo: invalid theme fields are stripped', () => {
  const db = freshDb();
  insertCompetition(db, {
    slug: 'a', title: 'A', type: 'kaggle',
    theme: { accent: 'not-a-hex', preset: 'unknown', junk: 1 },
  });
  // accent invalid → dropped; preset invalid → dropped; junk → dropped → empty → null
  assert.equal(getCompetition(db, 'a').theme, null);
});
