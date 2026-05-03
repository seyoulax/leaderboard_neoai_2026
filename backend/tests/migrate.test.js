import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrate } from '../src/migrate.js';

async function makeTempDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'neoai-migrate-'));
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

test('migrate: no-op when competitions.json already exists', async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, 'competitions.json'), '[]');
  await fs.writeFile(path.join(dir, 'tasks.json'), '[{"slug":"x","title":"x","competition":"x"}]');

  const result = await migrate(dir);

  assert.equal(result.migrated, false);
  assert.equal(await exists(path.join(dir, 'tasks.json')), true);
});

test('migrate: no-op when neither competitions.json nor legacy exists', async () => {
  const dir = await makeTempDir();
  const result = await migrate(dir);
  assert.equal(result.migrated, false);
  assert.equal(await exists(path.join(dir, 'competitions.json')), true);
  const indexRaw = await fs.readFile(path.join(dir, 'competitions.json'), 'utf8');
  assert.deepEqual(JSON.parse(indexRaw), []);
});

test('migrate: legacy → competitions/neoai-2026/', async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, 'tasks.json'), JSON.stringify([{ slug: 't1', title: 'T1', competition: 'kaggle-1' }]));
  await fs.writeFile(path.join(dir, 'boards.json'), JSON.stringify([{ slug: 'b1', title: 'B1', taskSlugs: ['t1'] }]));
  await fs.writeFile(path.join(dir, 'participants.json'), JSON.stringify([{ id: 'p1', name: 'Иванов Иван', kaggleId: 'iv1' }]));
  await fs.mkdir(path.join(dir, 'private'), { recursive: true });
  await fs.writeFile(path.join(dir, 'private', 't1.csv'), 'kaggle_id,raw_score\niv1,0.9');

  const result = await migrate(dir);

  assert.equal(result.migrated, true);
  assert.equal(result.competitionSlug, 'neoai-2026');
  // legacy moved into competitions/neoai-2026/
  assert.equal(await exists(path.join(dir, 'competitions/neoai-2026/tasks.json')), true);
  assert.equal(await exists(path.join(dir, 'competitions/neoai-2026/boards.json')), true);
  assert.equal(await exists(path.join(dir, 'competitions/neoai-2026/participants.json')), true);
  // private moved into private/neoai-2026/
  assert.equal(await exists(path.join(dir, 'private/neoai-2026/t1.csv')), true);
  // legacy gone from root
  assert.equal(await exists(path.join(dir, 'tasks.json')), false);
  assert.equal(await exists(path.join(dir, 'boards.json')), false);
  assert.equal(await exists(path.join(dir, 'participants.json')), false);
  // backup created
  const subs = await fs.readdir(dir);
  assert.ok(subs.some((s) => s.startsWith('_legacy-backup-')), `expected _legacy-backup-* in ${subs.join(',')}`);
  // index has neoai-2026
  const idx = JSON.parse(await fs.readFile(path.join(dir, 'competitions.json'), 'utf8'));
  assert.equal(idx.length, 1);
  assert.equal(idx[0].slug, 'neoai-2026');
  assert.equal(idx[0].title, 'NEOAI 2026');
});

test('migrate: idempotent — повторный запуск ничего не делает', async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, 'tasks.json'), '[]');
  await fs.writeFile(path.join(dir, 'boards.json'), '[]');
  await fs.writeFile(path.join(dir, 'participants.json'), '[]');

  const r1 = await migrate(dir);
  const r2 = await migrate(dir);

  assert.equal(r1.migrated, true);
  assert.equal(r2.migrated, false);
});
