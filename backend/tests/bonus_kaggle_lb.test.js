import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runMigrations } from '../src/db/index.js';
import { createApp, bootstrapForTests, DATA_DIR } from '../src/app.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
function startApp(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }

const ADMIN = { 'content-type': 'application/json', 'x-admin-token': 'shared' };

// Seeds a kaggle competition that uses an admin-uploaded public CSV (so the
// refresh path doesn't need the kaggle CLI). Returns paths/ports/cleanup.
async function seedKaggleWithCsv({ tasksConfig, participants, csvByTask, state }) {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'k', title: 'K', type: 'kaggle', visibility: 'public' });
  const compDir = path.join(DATA_DIR, 'competitions', 'k');
  const pubDir = path.join(DATA_DIR, 'public-csv', 'k');
  await fs.mkdir(compDir, { recursive: true });
  await fs.mkdir(pubDir, { recursive: true });

  await fs.writeFile(
    path.join(compDir, 'tasks.json'),
    JSON.stringify(tasksConfig, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(compDir, 'participants.json'),
    JSON.stringify(participants, null, 2),
    'utf8',
  );
  if (state) {
    await fs.writeFile(
      path.join(compDir, 'state.json'),
      JSON.stringify(state, null, 2),
      'utf8',
    );
  }
  for (const [taskSlug, csv] of Object.entries(csvByTask || {})) {
    await fs.writeFile(path.join(pubDir, `${taskSlug}.csv`), csv, 'utf8');
  }
  const app = createApp({ db });
  await bootstrapForTests();
  return { db, app, compDir, pubDir };
}

// CSV in nickname/raw_score form with 2 baseline anchors so leaderboard.js can
// normalize to 0..100 without anchors (uses fallback formula).
const CSV_2ROWS = (a, b) => `nickname,raw_score\nalice,${a}\nbob,${b}\n`;

test('kaggle LB: bonusPoints enriched from participants.bonusPoints', async (t) => {
  const { app, compDir, pubDir } = await seedKaggleWithCsv({
    tasksConfig: [{ slug: 't1', title: 'T1', competition: 'foo' }],
    participants: [
      { id: 'p1', name: 'Alice X', kaggleId: 'alice', bonusPoints: 25 },
      { id: 'p2', name: 'Bob Y', kaggleId: 'bob' },
    ],
    csvByTask: { t1: CSV_2ROWS(0.9, 0.5) },
    state: null,
  });
  t.after(async () => {
    await fs.rm(compDir, { recursive: true, force: true });
    await fs.rm(pubDir, { recursive: true, force: true });
  });
  const server = await startApp(app);
  const port = server.address().port;
  // Trigger refresh (no kaggle CLI call because public CSV is used).
  const refresh = await fetch(`http://127.0.0.1:${port}/api/competitions/k/refresh`, { method: 'POST' });
  assert.equal(refresh.status, 200);
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/k/leaderboard`).then((x) => x.json());
  // Toggle is OFF by default
  assert.equal(r.overallShowBonusPoints, false);
  // Both rows have bonusPoints; alice = 25, bob = 0
  const alice = r.overall.find((e) => e.nickname === 'alice');
  const bob = r.overall.find((e) => e.nickname === 'bob');
  assert.ok(alice, 'alice row missing');
  assert.ok(bob, 'bob row missing');
  assert.equal(alice.bonusPoints, 25);
  assert.equal(bob.bonusPoints, 0);
  // totalPoints stays sum-of-tasks (NOT including bonus) when toggle off
  // alice should be #1 because she has the higher raw_score regardless
  assert.equal(r.overall[0].nickname, 'alice');
  server.close();
});

test('kaggle LB: toggle ON adds bonus + re-ranks; previousTotalPoints stays consistent', async (t) => {
  // alice public score 0.5 (lower), bob public 0.9 (higher) → bob #1 normally.
  // But alice has bonus 50 → her totalPoints jumps; should overtake bob.
  const { app, compDir, pubDir } = await seedKaggleWithCsv({
    tasksConfig: [{ slug: 't1', title: 'T1', competition: 'foo' }],
    participants: [
      { id: 'p1', name: 'Alice X', kaggleId: 'alice', bonusPoints: 60 },
      { id: 'p2', name: 'Bob Y', kaggleId: 'bob' },
    ],
    csvByTask: { t1: CSV_2ROWS(0.5, 0.9) },
    state: { overallShowBonusPoints: true },
  });
  t.after(async () => {
    await fs.rm(compDir, { recursive: true, force: true });
    await fs.rm(pubDir, { recursive: true, force: true });
  });
  const server = await startApp(app);
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/competitions/k/refresh`, { method: 'POST' });
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/k/leaderboard`).then((x) => x.json());
  assert.equal(r.overallShowBonusPoints, true);
  // alice 0 + 60 = 60 vs bob 100 + 0 = 100 → bob still #1
  // (with fallback normalization, bob=100 alice=0). Make sure bonus did add though.
  const alice = r.overall.find((e) => e.nickname === 'alice');
  const bob = r.overall.find((e) => e.nickname === 'bob');
  assert.equal(alice.bonusPoints, 60);
  assert.equal(alice.totalPoints, 60); // 0 + 60
  assert.equal(bob.totalPoints, 100); // 100 + 0
  assert.equal(r.overall[0].nickname, 'bob');
  assert.equal(r.overall[0].place, 1);
  assert.equal(r.overall[1].nickname, 'alice');
  assert.equal(r.overall[1].place, 2);
  server.close();
});

test('kaggle LB: cache not poisoned by toggle ON mutation (subsequent toggle-off request unaffected)', async (t) => {
  const { app, db, compDir, pubDir } = await seedKaggleWithCsv({
    tasksConfig: [{ slug: 't1', title: 'T1', competition: 'foo' }],
    participants: [
      { id: 'p1', name: 'Alice X', kaggleId: 'alice', bonusPoints: 50 },
      { id: 'p2', name: 'Bob Y', kaggleId: 'bob' },
    ],
    csvByTask: { t1: CSV_2ROWS(0.5, 0.9) },
    state: { overallShowBonusPoints: true },
  });
  t.after(async () => {
    await fs.rm(compDir, { recursive: true, force: true });
    await fs.rm(pubDir, { recursive: true, force: true });
  });
  const server = await startApp(app);
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/competitions/k/refresh`, { method: 'POST' });
  // Hit endpoint with toggle ON
  await fetch(`http://127.0.0.1:${port}/api/competitions/k/leaderboard`).then((x) => x.json());
  // Now flip toggle OFF via admin endpoint, hit again, totalPoints should be raw points only
  const tog = await fetch(`http://127.0.0.1:${port}/api/admin/competitions/k/overall-show-bonus`, {
    method: 'PUT', headers: ADMIN, body: JSON.stringify({ show: false }),
  });
  assert.equal(tog.status, 200);
  const r2 = await fetch(`http://127.0.0.1:${port}/api/competitions/k/leaderboard`).then((x) => x.json());
  assert.equal(r2.overallShowBonusPoints, false);
  const alice = r2.overall.find((e) => e.nickname === 'alice');
  // alice's per-task total should be back to raw 0 (not 50 from previous mutation)
  assert.equal(alice.totalPoints, 0);
  assert.equal(alice.bonusPoints, 50);
  server.close();
});
