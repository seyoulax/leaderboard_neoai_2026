import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createApp, bootstrapForTests } from '../src/app.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';

let _slugCounter = 0;
function uniqueSlug() {
  _slugCounter++;
  return `t-${process.pid}-${_slugCounter}-${Date.now().toString(36)}`;
}

async function setupApp() {
  process.env.ADMIN_TOKEN = 'shared';
  const slug = uniqueSlug();
  const db = new Database(':memory:');
  runMigrations(db);
  insertCompetition(db, { slug, title: 'C', type: 'kaggle', visibility: 'public' });
  const app = createApp({ db });
  await bootstrapForTests();
  const { cache, DATA_DIR } = await import('../src/app.js');
  cache.byCompetition.set(slug, {
    groupsResults: {
      g1: {
        overall: [
          { kaggleId: 'alice', place: 1 },
          { kaggleId: 'bob', place: 2 },
        ],
      },
    },
  });
  const compDir = path.join(DATA_DIR, 'competitions', slug);
  return {
    db, app, slug,
    cleanup: () => {
      try { fs.rmSync(compDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

function start(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }

const CSV_TEXT = `kaggleId,fullName,points,bonus
alice,Alice Wonder,80,5
bob,Bob Builder,90,0
carol,Carol King,70,10`;

test('full happy path: upload → settings → start → advance → finished', async () => {
  const { app, slug, cleanup } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api`;
  const adminH = { 'x-admin-token': 'shared', 'content-type': 'application/json' };

  let r = await fetch(`${base}/admin/competitions/${slug}/results/upload`, {
    method: 'PUT', headers: adminH, body: JSON.stringify({ csv: CSV_TEXT }),
  });
  if (r.status !== 200) assert.fail(await r.text());
  const uploaded = await r.json();
  assert.equal(uploaded.phase, 'uploaded');
  assert.equal(uploaded.rows.length, 3);

  r = await fetch(`${base}/competitions/${slug}/results`);
  const pub1 = await r.json();
  assert.equal(pub1.phase, 'uploaded');
  assert.equal(pub1.revealedRows.length, 0);
  assert.equal(JSON.stringify(pub1).includes('Alice'), false);

  r = await fetch(`${base}/admin/competitions/${slug}/results/settings`, {
    method: 'PUT', headers: adminH, body: JSON.stringify({ compareGroupSlug: 'g1' }),
  });
  if (r.status !== 200) assert.fail(await r.text());

  r = await fetch(`${base}/admin/competitions/${slug}/results/start`, {
    method: 'POST', headers: adminH, body: '{}',
  });
  if (r.status !== 200) assert.fail(await r.text());
  const started = await r.json();
  assert.equal(started.phase, 'revealing');
  assert.equal(started.cursor.stage, 'drum_roll');

  let cur = started;
  for (let i = 0; i < 30; i++) {
    if (cur.phase === 'finished') break;
    r = await fetch(`${base}/admin/competitions/${slug}/results/advance`, {
      method: 'POST', headers: adminH, body: JSON.stringify({ expectedStepId: cur.stepId }),
    });
    if (r.status !== 200) assert.fail(await r.text());
    cur = await r.json();
  }
  assert.equal(cur.phase, 'finished');

  r = await fetch(`${base}/competitions/${slug}/results`);
  const pubFinal = await r.json();
  assert.equal(pubFinal.phase, 'finished');
  assert.equal(pubFinal.finalRows.length, 3);
  assert.equal(pubFinal.finalRows[0].rank, 1);
  assert.equal(JSON.stringify(pubFinal).includes('"kaggleId"'), false);

  server.close();
  cleanup();
});

test('upload requires admin', async () => {
  const { app, slug, cleanup } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/upload`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: CSV_TEXT }),
  });
  assert.equal(r.status, 401);
  server.close();
  cleanup();
});

test('start without settings → 409', async () => {
  const { app, slug, cleanup } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const adminH = { 'x-admin-token': 'shared', 'content-type': 'application/json' };
  await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/upload`, {
    method: 'PUT', headers: adminH, body: JSON.stringify({ csv: CSV_TEXT }),
  });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/start`, {
    method: 'POST', headers: adminH, body: '{}',
  });
  assert.equal(r.status, 409);
  server.close();
  cleanup();
});

test('reset clears state', async () => {
  const { app, slug, cleanup } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const adminH = { 'x-admin-token': 'shared', 'content-type': 'application/json' };

  await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/upload`, {
    method: 'PUT', headers: adminH, body: JSON.stringify({ csv: CSV_TEXT }),
  });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/reset`, {
    method: 'POST', headers: adminH,
  });
  assert.equal(r.status, 200);
  const pub = await fetch(`http://127.0.0.1:${port}/api/competitions/${slug}/results`).then((x) => x.json());
  assert.equal(pub.phase, 'idle');
  server.close();
  cleanup();
});

test('SSE stream pushes initial state', async () => {
  const { app, slug, cleanup } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const ctrl = new AbortController();
  const resp = await fetch(`http://127.0.0.1:${port}/api/competitions/${slug}/results/stream`, {
    headers: { accept: 'text/event-stream' },
    signal: ctrl.signal,
  });
  assert.equal(resp.status, 200);
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (let i = 0; i < 5; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    if (buf.includes('event: state')) break;
  }
  assert.match(buf, /event: state/);
  assert.match(buf, /"phase":"idle"/);
  ctrl.abort();
  server.close();
  cleanup();
});

test('stepId mismatch on advance → 409', async () => {
  const { app, slug, cleanup } = await setupApp();
  const server = await start(app);
  const port = server.address().port;
  const adminH = { 'x-admin-token': 'shared', 'content-type': 'application/json' };
  await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/upload`, {
    method: 'PUT', headers: adminH, body: JSON.stringify({ csv: CSV_TEXT }),
  });
  await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/settings`, {
    method: 'PUT', headers: adminH, body: JSON.stringify({ compareGroupSlug: 'g1' }),
  });
  await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/start`, {
    method: 'POST', headers: adminH, body: '{}',
  });
  const r = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/${slug}/results/advance`, {
    method: 'POST', headers: adminH, body: JSON.stringify({ expectedStepId: 999 }),
  });
  assert.equal(r.status, 409);
  server.close();
  cleanup();
});
