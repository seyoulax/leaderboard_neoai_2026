import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { insertSubmission, getSubmission } from '../src/db/submissionsRepo.js';
import { tick } from '../src/scoring/worker.js';
import { insertNativeTask, updateNativeTask } from '../src/db/nativeTasksRepo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(__dirname, 'fixtures/grader');

function setup(graderName, opts = {}) {
  const db = new Database(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO competitions (slug, title, type) VALUES ('c', 'C', 'native')").run();
  insertNativeTask(db, {
    competitionSlug: 'c', slug: 't', title: 'T',
    baselineScorePublic: opts.baselinePublic, authorScorePublic: opts.authorPublic,
    baselineScorePrivate: opts.baselinePrivate, authorScorePrivate: opts.authorPrivate,
  });
  if (opts.privateGT) updateNativeTask(db, 'c', 't', { groundTruthPrivatePath: opts.privateGT });
  if (opts.publicGT) updateNativeTask(db, 'c', 't', { groundTruthPath: opts.publicGT });
  if (opts.grader) updateNativeTask(db, 'c', 't', { graderPath: path.join(FX, graderName) });
  db.prepare("INSERT INTO users (email, password_hash, display_name) VALUES ('a@a.a', 'h', 'A')").run();
  return db;
}

function makeFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3w-'));
  const file = path.join(dir, 'sub.csv');
  fs.writeFileSync(file, content);
  return { file, dir };
}

test('worker.tick: public-only — task без private GT, single grader run', async () => {
  const { file: gt, dir: dGt } = makeFile('truth');
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-ok.py', {
    grader: true, publicGT: gt,
    baselinePublic: 0.5, authorPublic: 0.95,
  });
  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  await tick(db, { timeoutMs: 5000 });
  const got = getSubmission(db, submission.id);
  assert.equal(got.status, 'scored');
  assert.equal(got.rawScorePublic, 0.85);
  assert.ok(Math.abs(got.pointsPublic - ((0.85 - 0.5) / (0.95 - 0.5) * 100)) < 0.001);
  assert.equal(got.rawScorePrivate, null);
  assert.equal(got.pointsPrivate, null);
  fs.rmSync(dGt, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
});

test('worker.tick: idle — нет pending → ничего не делает', async () => {
  const db = setup('score-ok.py', { grader: true });
  await tick(db, { timeoutMs: 5000 });
});

test('worker.tick: public+private — оба запуска, оба points', async () => {
  const { file: gtPub, dir: dGtPub } = makeFile('truth-pub');
  const { file: gtPriv, dir: dGtPriv } = makeFile('truth-priv');
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-ok.py', {
    grader: true, publicGT: gtPub, privateGT: gtPriv,
    baselinePublic: 0.5, authorPublic: 0.95,
    baselinePrivate: 0.4, authorPrivate: 0.85,
  });
  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  await tick(db, { timeoutMs: 5000 });
  const got = getSubmission(db, submission.id);
  assert.equal(got.status, 'scored');
  assert.equal(got.rawScorePublic, 0.85);
  assert.equal(got.rawScorePrivate, 0.85);
  assert.ok(Math.abs(got.pointsPrivate - 100) < 0.001);
  fs.rmSync(dGtPub, { recursive: true });
  fs.rmSync(dGtPriv, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
});

test('worker.tick: private grader fails → public still scored, private NULL, log [private failed]', async () => {
  const { file: gtPub, dir: dGtPub } = makeFile('truth');
  const { file: sub, dir: dSub } = makeFile('any');
  const fakeGtPriv = '/nonexistent/path/private-gt.csv';
  const db = setup('score-ok.py', {
    grader: false, publicGT: gtPub, privateGT: fakeGtPriv,
    baselinePublic: 0, authorPublic: 1,
  });

  // Inline grader, который проверяет что gt существует:
  const inlineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3-inline-'));
  const inlineGrader = path.join(inlineDir, 'g.py');
  fs.writeFileSync(inlineGrader, `#!/usr/bin/env python3
import sys, os
sub_path, gt_path = sys.argv[1], sys.argv[2]
if not os.path.exists(gt_path):
    sys.stderr.write('gt not found\\n')
    sys.exit(2)
print('0.5')
`);
  fs.chmodSync(inlineGrader, 0o755);
  updateNativeTask(db, 'c', 't', { graderPath: inlineGrader });

  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  await tick(db, { timeoutMs: 5000 });
  const got = getSubmission(db, submission.id);
  assert.equal(got.status, 'scored');
  assert.equal(got.rawScorePublic, 0.5);
  assert.equal(got.pointsPrivate, null);
  assert.match(got.logExcerpt || '', /\[private failed\]/);
  fs.rmSync(dGtPub, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
  fs.rmSync(inlineDir, { recursive: true });
});

test('worker: retry budget — 3 фейла подряд → status=failed окончательно', async () => {
  const { file: gt, dir: dGt } = makeFile('truth');
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-error.py', { grader: true, publicGT: gt });
  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  await tick(db, { timeoutMs: 5000 });
  assert.equal(getSubmission(db, submission.id).status, 'pending');
  assert.equal(getSubmission(db, submission.id).attempts, 1);
  await tick(db, { timeoutMs: 5000 });
  assert.equal(getSubmission(db, submission.id).status, 'pending');
  assert.equal(getSubmission(db, submission.id).attempts, 2);
  await tick(db, { timeoutMs: 5000 });
  assert.equal(getSubmission(db, submission.id).status, 'failed');
  fs.rmSync(dGt, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
});

test('worker: stale recovery — старый scoring возвращается в pending на следующем tick', async () => {
  const { file: gt, dir: dGt } = makeFile('truth');
  const { file: sub, dir: dSub } = makeFile('any');
  const db = setup('score-ok.py', { grader: true, publicGT: gt });
  const submission = insertSubmission(db, { taskId: 1, userId: 1, originalFilename: 'sub', sizeBytes: 1, sha256: 'x', path: sub });
  db.prepare("UPDATE submissions SET status='scoring', started_at=datetime('now', '-30 minutes') WHERE id=?").run(submission.id);
  await tick(db, { timeoutMs: 5000 });
  assert.equal(getSubmission(db, submission.id).status, 'scored');
  fs.rmSync(dGt, { recursive: true });
  fs.rmSync(dSub, { recursive: true });
});
