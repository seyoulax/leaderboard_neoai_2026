import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

let server;
let baseUrl;
let dataDir;

async function fetchJson(p, opts = {}) {
  const res = await fetch(baseUrl + p, opts);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

before(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neoai-rt-'));
  await fs.mkdir(path.join(dataDir, 'competitions/test-comp'), { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'competitions.json'),
    JSON.stringify([{ slug: 'test-comp', title: 'Test', order: 0, visible: true }], null, 2)
  );
  await fs.writeFile(path.join(dataDir, 'competitions/test-comp/tasks.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'competitions/test-comp/boards.json'), '[]');
  await fs.writeFile(path.join(dataDir, 'competitions/test-comp/participants.json'), '[]');

  process.env.DATA_DIR = dataDir;
  process.env.PORT = '0';
  process.env.REFRESH_MS = '999999999';
  process.env.KAGGLE_CMD = '/bin/false';
  process.env.REQUEST_GAP_MS = '0';

  const mod = await import('../src/app.js');
  const app = mod.createApp();
  await mod.bootstrapForTests();

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('GET /api/health returns 200 with competitions array', async () => {
  const { status, body } = await fetchJson('/api/health');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.competitions));
});

test('GET /api/competitions returns visible list', async () => {
  const { status, body } = await fetchJson('/api/competitions');
  assert.equal(status, 200);
  assert.equal(body.competitions.length, 1);
  assert.equal(body.competitions[0].slug, 'test-comp');
});

test('GET /api/competitions/test-comp returns meta', async () => {
  const { status, body } = await fetchJson('/api/competitions/test-comp');
  assert.equal(status, 200);
  assert.equal(body.competition.slug, 'test-comp');
});

test('GET /api/competitions/test-comp/leaderboard 200 (empty)', async () => {
  const { status, body } = await fetchJson('/api/competitions/test-comp/leaderboard');
  assert.equal(status, 200);
  assert.deepEqual(body.overall, []);
});

test('GET /api/competitions/wrong/leaderboard 404', async () => {
  const { status, body } = await fetchJson('/api/competitions/wrong/leaderboard');
  assert.equal(status, 404);
  assert.match(body.error, /not found/i);
});
