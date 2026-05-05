import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runGrader } from '../src/scoring/runGrader.js';
import { computePoints } from '../src/scoring/computePoints.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(__dirname, 'fixtures/grader');

function makeSubFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp3-'));
  const file = path.join(dir, 'sub.csv');
  fs.writeFileSync(file, content);
  return { file, dir };
}

// ─── runGrader ───────────────────────────────────────────────────

test('runGrader: happy path → 0.85', async () => {
  const { file, dir } = makeSubFile('any');
  const r = await runGrader({
    graderPath: path.join(FX, 'score-ok.py'),
    gtPath: file,
    subPath: file,
    timeoutMs: 5000,
  });
  assert.equal(r.rawScore, 0.85);
  assert.ok(typeof r.durationMs === 'number');
  fs.rmSync(dir, { recursive: true });
});

test('runGrader: anchored — picks score from sub file', async () => {
  const { file, dir } = makeSubFile('0.42\n');
  const r = await runGrader({
    graderPath: path.join(FX, 'score-anchored.py'),
    gtPath: file, subPath: file, timeoutMs: 5000,
  });
  assert.equal(r.rawScore, 0.42);
  fs.rmSync(dir, { recursive: true });
});

test('runGrader: exit≠0 rejects with log', async () => {
  const { file, dir } = makeSubFile('x');
  await assert.rejects(
    () => runGrader({
      graderPath: path.join(FX, 'score-error.py'),
      gtPath: file, subPath: file, timeoutMs: 5000,
    }),
    (e) => /exit code 1/i.test(e.error) && /grader exploded/.test(e.log),
  );
  fs.rmSync(dir, { recursive: true });
});

test('runGrader: timeout', async () => {
  const { file, dir } = makeSubFile('x');
  await assert.rejects(
    () => runGrader({
      graderPath: path.join(FX, 'score-timeout.py'),
      gtPath: file, subPath: file, timeoutMs: 200,
    }),
    (e) => /timeout/i.test(e.error),
  );
  fs.rmSync(dir, { recursive: true });
});

test('runGrader: invalid stdout (NaN)', async () => {
  const { file, dir } = makeSubFile('x');
  await assert.rejects(
    () => runGrader({
      graderPath: path.join(FX, 'score-bad.py'),
      gtPath: file, subPath: file, timeoutMs: 5000,
    }),
    (e) => /invalid score/i.test(e.error),
  );
  fs.rmSync(dir, { recursive: true });
});

// ─── computePoints ───────────────────────────────────────────────

test('computePoints: anchored higher-better', () => {
  const p = computePoints({ raw: 0.80, baseline: 0.5, author: 0.95, higherIsBetter: true });
  assert.ok(Math.abs(p - 66.6666666) < 0.001);
});

test('computePoints: anchored lower-better (RMSE-style)', () => {
  const p = computePoints({ raw: 0.6, baseline: 1.0, author: 0.2, higherIsBetter: false });
  assert.ok(Math.abs(p - 50) < 0.001);
});

test('computePoints: max(0, ...) — хуже baseline = 0', () => {
  assert.equal(computePoints({ raw: 0.4, baseline: 0.5, author: 0.95, higherIsBetter: true }), 0);
});

test('computePoints: без якорей возвращает raw', () => {
  assert.equal(computePoints({ raw: 0.85, baseline: null, author: null, higherIsBetter: true }), 0.85);
  assert.equal(computePoints({ raw: 0.85, baseline: 0.5, author: null, higherIsBetter: true }), 0.85);
});

test('computePoints: precedes 100 если raw > author', () => {
  const p = computePoints({ raw: 0.97, baseline: 0.5, author: 0.95, higherIsBetter: true });
  assert.ok(p > 100);
});
