import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/index.js';
import { createUser } from '../src/db/usersRepo.js';
import { insertCompetition } from '../src/db/competitionsRepo.js';
import { insertNativeTask } from '../src/db/nativeTasksRepo.js';
import {
  insertSubmission,
  pickAndMarkScoring,
  markScored,
} from '../src/db/submissionsRepo.js';
import { joinCompetition, setBonusPoints } from '../src/db/membersRepo.js';
import { buildNativeLeaderboard } from '../src/scoring/nativeLeaderboard.js';
import { applyBonusToOverall } from '../src/leaderboardBonus.js';

function freshDb() { const db = new Database(':memory:'); runMigrations(db); return db; }
function startApp(app) { return new Promise((r) => { const s = app.listen(0, () => r(s)); }); }

function scoreSub(db, taskId, userId, points) {
  const s = insertSubmission(db, {
    taskId, userId,
    originalFilename: 'sub', sizeBytes: 1, sha256: `${taskId}-${userId}-${points}-${Math.random()}`, path: '/x',
  });
  pickAndMarkScoring(db);
  markScored(db, s.id, { rawScorePublic: points / 100, pointsPublic: points, log: '', durationMs: 1 });
  return s.id;
}

test('buildNativeLeaderboard: every overall row carries bonusPoints (0 default)', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  scoreSub(db, t.id, u.id, 50);
  // No membership row.
  const lb = buildNativeLeaderboard(db, 'c', 'public');
  assert.equal(lb.overall.length, 1);
  assert.equal(lb.overall[0].bonusPoints, 0);
  // totalPoints stays equal to per-task sum (NEVER includes bonus at build time)
  assert.equal(lb.overall[0].totalPoints, 50);
});

test('buildNativeLeaderboard: bonusPoints picked up from competition_members', () => {
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  scoreSub(db, t.id, u.id, 50);
  joinCompetition(db, 'c', u.id);
  setBonusPoints(db, 'c', u.id, 30);
  const lb = buildNativeLeaderboard(db, 'c', 'public');
  assert.equal(lb.overall[0].bonusPoints, 30);
  // totalPoints stays 50 (per-task sum); applyBonusToOverall is the only path that adds bonus.
  assert.equal(lb.overall[0].totalPoints, 50);
});

test('applyBonusToOverall: adds bonus and re-sorts/re-places', () => {
  const overall = [
    { participantKey: 'user:1', totalPoints: 100, previousTotalPoints: 90, bonusPoints: 0, place: 1 },
    { participantKey: 'user:2', totalPoints: 80, previousTotalPoints: null, bonusPoints: 50, place: 2 },
    { participantKey: 'user:3', totalPoints: 95, previousTotalPoints: 90, bonusPoints: 10, place: 3 },
  ];
  applyBonusToOverall(overall);
  // user:2 jumps to #1 with 130, user:3 → 105 #2, user:1 → 100 #3
  assert.equal(overall[0].participantKey, 'user:2');
  assert.equal(overall[0].totalPoints, 130);
  assert.equal(overall[0].place, 1);
  assert.equal(overall[1].participantKey, 'user:3');
  assert.equal(overall[1].totalPoints, 105);
  assert.equal(overall[1].place, 2);
  assert.equal(overall[1].previousTotalPoints, 100); // 90 + 10
  assert.equal(overall[2].participantKey, 'user:1');
  assert.equal(overall[2].place, 3);
  // null previous stays null
  assert.equal(overall.find((r) => r.participantKey === 'user:2').previousTotalPoints, null);
});

test('applyBonusToOverall: bonus=0 leaves rows unchanged in totals', () => {
  const overall = [
    { participantKey: 'user:1', totalPoints: 100, previousTotalPoints: 80, bonusPoints: 0, place: 1 },
  ];
  applyBonusToOverall(overall);
  assert.equal(overall[0].totalPoints, 100);
  assert.equal(overall[0].previousTotalPoints, 80);
});

// ─── endpoint: native LB applies overallShowBonusPoints toggle ───────

import { createApp, bootstrapForTests, DATA_DIR } from '../src/app.js';
import path from 'node:path';
import fs from 'node:fs/promises';

async function setupNativeWithBonus({ show }) {
  process.env.ADMIN_TOKEN = 'shared';
  const db = freshDb();
  insertCompetition(db, { slug: 'c', title: 'C', type: 'native', visibility: 'public' });
  const t = insertNativeTask(db, { competitionSlug: 'c', slug: 't', title: 'T' });
  const u1 = createUser(db, { email: 'a@a.a', passwordHash: 'h', displayName: 'A' });
  const u2 = createUser(db, { email: 'b@b.b', passwordHash: 'h', displayName: 'B' });
  scoreSub(db, t.id, u1.id, 100);
  scoreSub(db, t.id, u2.id, 80);
  joinCompetition(db, 'c', u1.id);
  joinCompetition(db, 'c', u2.id);
  setBonusPoints(db, 'c', u1.id, 0);
  setBonusPoints(db, 'c', u2.id, 50);

  // Write state.json with overallShowBonusPoints = show, in the actual DATA_DIR
  // that the running app uses (DATA_DIR is resolved at module load time).
  const compDir = path.join(DATA_DIR, 'competitions', 'c');
  await fs.mkdir(compDir, { recursive: true });
  await fs.writeFile(
    path.join(compDir, 'state.json'),
    JSON.stringify({ overallShowBonusPoints: !!show }, null, 2),
    'utf8',
  );

  const app = createApp({ db });
  await bootstrapForTests();
  return { db, app, compDir };
}

test('GET /leaderboard (native): toggle OFF — totals = task sum, bonus column present', async (t) => {
  const { app, compDir } = await setupNativeWithBonus({ show: false });
  t.after(() => fs.rm(compDir, { recursive: true, force: true }));
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/leaderboard`).then((x) => x.json());
  assert.equal(r.overallShowBonusPoints, false);
  // u1 = 100 #1, u2 = 80 #2
  assert.equal(r.overall[0].nickname, 'A');
  assert.equal(r.overall[0].totalPoints, 100);
  assert.equal(r.overall[0].bonusPoints, 0);
  assert.equal(r.overall[1].nickname, 'B');
  assert.equal(r.overall[1].totalPoints, 80);
  assert.equal(r.overall[1].bonusPoints, 50);
  server.close();
});

test('GET /leaderboard (native): toggle ON — bonus added & re-ranked', async (t) => {
  const { app, compDir } = await setupNativeWithBonus({ show: true });
  t.after(() => fs.rm(compDir, { recursive: true, force: true }));
  const server = await startApp(app);
  const port = server.address().port;
  const r = await fetch(`http://127.0.0.1:${port}/api/competitions/c/leaderboard`).then((x) => x.json());
  assert.equal(r.overallShowBonusPoints, true);
  // u2: 80 + 50 = 130 → #1
  assert.equal(r.overall[0].nickname, 'B');
  assert.equal(r.overall[0].totalPoints, 130);
  assert.equal(r.overall[0].bonusPoints, 50);
  assert.equal(r.overall[0].place, 1);
  assert.equal(r.overall[1].nickname, 'A');
  assert.equal(r.overall[1].totalPoints, 100);
  assert.equal(r.overall[1].place, 2);
  server.close();
});
