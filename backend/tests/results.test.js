import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASE,
  STAGE,
  TOP8_STEPS,
  initialState,
  parseResultsCsv,
  computeSkipPlan,
  computePublicPlaces,
  reduceUpload,
  reduceSetSettings,
  reduceStart,
  reduceAdvance,
  reduceReset,
  redact,
} from '../src/results.js';

// ---------- parseResultsCsv ----------

test('parseResultsCsv: minimal CSV, sorts desc by points+bonus', () => {
  const text = `kaggleId,fullName,points,bonus
alice,Alice Wonder,80,5
bob,Bob Builder,90,0
carol,Carol King,70,10`;
  const rows = parseResultsCsv(text);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].kaggleId, 'bob');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].points, 90);
  assert.equal(rows[1].kaggleId, 'alice');
  assert.equal(rows[2].kaggleId, 'carol');
});

test('parseResultsCsv: BOM + CRLF + semicolons', () => {
  const text = '\ufeffkaggleId;fullName;points;bonus\r\na;A Aaaa;50;0\r\nb;B Bbbb;60;0\r\n';
  const rows = parseResultsCsv(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kaggleId, 'b');
});

test('parseResultsCsv: header aliases (nick, fio, score)', () => {
  const text = `nick,fio,score,bonus
x,X User,42,1`;
  const rows = parseResultsCsv(text);
  assert.equal(rows[0].kaggleId, 'x');
  assert.equal(rows[0].fullName, 'X User');
  assert.equal(rows[0].points, 42);
});

test('parseResultsCsv: optional bonus defaults to 0', () => {
  const text = `kaggleId,fullName,points
a,A,10
b,B,20`;
  const rows = parseResultsCsv(text);
  assert.equal(rows[0].bonus, 0);
  assert.equal(rows[0].kaggleId, 'b');
});

test('parseResultsCsv: rejects empty file', () => {
  assert.throws(() => parseResultsCsv(''), /empty/i);
});

test('parseResultsCsv: rejects missing required column', () => {
  assert.throws(
    () => parseResultsCsv(`foo,bar\n1,2`),
    /missing required columns/i,
  );
});

test('parseResultsCsv: rejects empty kaggleId with line number', () => {
  const text = `kaggleId,fullName,points
,X,10`;
  assert.throws(() => parseResultsCsv(text), /line 2.*kaggleId/i);
});

test('parseResultsCsv: rejects duplicate kaggleId', () => {
  const text = `kaggleId,fullName,points
a,A,10
a,A2,20`;
  assert.throws(() => parseResultsCsv(text), /duplicate/i);
});

test('parseResultsCsv: rejects malformed points', () => {
  const text = `kaggleId,fullName,points
a,A,abc`;
  assert.throws(() => parseResultsCsv(text), /invalid points/i);
});

test('parseResultsCsv: comma-decimal accepted', () => {
  const text = `kaggleId,fullName,points,bonus
a,A,"12,5",0`;
  const rows = parseResultsCsv(text);
  assert.equal(rows[0].points, 12.5);
});

test('parseResultsCsv: lowercases kaggleId', () => {
  const text = `kaggleId,fullName,points
ALICE,Alice,10`;
  const rows = parseResultsCsv(text);
  assert.equal(rows[0].kaggleId, 'alice');
});

test('parseResultsCsv: trailing blank lines tolerated', () => {
  const text = `kaggleId,fullName,points
a,A,10

`;
  const rows = parseResultsCsv(text);
  assert.equal(rows.length, 1);
});

// ---------- computeSkipPlan ----------

test('computeSkipPlan N=0', () => {
  assert.deepEqual(computeSkipPlan(0), { outsiders: [], skipped: [] });
});
test('computeSkipPlan N=5 (≤8)', () => {
  assert.deepEqual(computeSkipPlan(5), { outsiders: [], skipped: [] });
});
test('computeSkipPlan N=8 (≤8)', () => {
  assert.deepEqual(computeSkipPlan(8), { outsiders: [], skipped: [] });
});
test('computeSkipPlan N=9', () => {
  assert.deepEqual(computeSkipPlan(9), { outsiders: [9], skipped: [] });
});
test('computeSkipPlan N=10', () => {
  assert.deepEqual(computeSkipPlan(10), { outsiders: [10, 9], skipped: [] });
});
test('computeSkipPlan N=11', () => {
  assert.deepEqual(computeSkipPlan(11), { outsiders: [11, 10, 9], skipped: [] });
});
test('computeSkipPlan N=30', () => {
  const plan = computeSkipPlan(30);
  assert.deepEqual(plan.outsiders, [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9]);
  assert.deepEqual(plan.skipped, []);
});

// ---------- computePublicPlaces ----------

test('computePublicPlaces: matches by kaggleId', () => {
  const rows = [
    { rank: 1, kaggleId: 'alice' },
    { rank: 2, kaggleId: 'bob' },
    { rank: 3, kaggleId: 'carol' },
  ];
  const groupOverall = [
    { kaggleId: 'bob', place: 1 },
    { kaggleId: 'alice', place: 2 },
    // carol absent
  ];
  const out = computePublicPlaces(rows, groupOverall);
  assert.equal(out[0].publicPlaceInGroup, 2);
  assert.equal(out[1].publicPlaceInGroup, 1);
  assert.equal(out[2].publicPlaceInGroup, null);
});

test('computePublicPlaces: handles empty / missing group', () => {
  const rows = [{ rank: 1, kaggleId: 'a' }];
  assert.equal(computePublicPlaces(rows, []).at(0).publicPlaceInGroup, null);
  assert.equal(computePublicPlaces(rows, undefined).at(0).publicPlaceInGroup, null);
});

// ---------- reducers ----------

function makeRows(n) {
  // n descending-points rows
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({ kaggleId: `u${i}`, fullName: `User ${i}`, points: 100 - i, bonus: 0, rank: i + 1 });
  }
  return rows;
}

test('reduceUpload: idle→uploaded', () => {
  const s0 = initialState();
  const rows = makeRows(3);
  const s1 = reduceUpload(s0, rows);
  assert.equal(s1.phase, PHASE.UPLOADED);
  assert.equal(s1.rows.length, 3);
  assert.equal(s1.stepId, 1);
});

test('reduceUpload: blocks during revealing', () => {
  const s = { ...initialState(), phase: PHASE.REVEALING };
  assert.throws(() => reduceUpload(s, []), /in progress/);
});

test('reduceSetSettings: stores compareGroupSlug', () => {
  const s = reduceUpload(initialState(), makeRows(2));
  const s2 = reduceSetSettings(s, { compareGroupSlug: 'philippines' });
  assert.equal(s2.compareGroupSlug, 'philippines');
});

test('reduceStart: N>8 enters OUTSIDERS with all places N..9', () => {
  let s = reduceUpload(initialState(), makeRows(10));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  const s2 = reduceStart(s, { groupOverall: [] });
  assert.equal(s2.phase, PHASE.REVEALING);
  assert.equal(s2.cursor.stage, STAGE.OUTSIDERS);
  assert.equal(s2.cursor.outsidersIdx, 0);
  assert.deepEqual(s2.skipPlan.outsiders, [10, 9]);
  assert.deepEqual(s2.skipPlan.skipped, []);
});

test('reduceStart: N≤8 jumps to DRUM_ROLL', () => {
  let s = reduceUpload(initialState(), makeRows(5));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  const s2 = reduceStart(s, { groupOverall: [] });
  assert.equal(s2.cursor.stage, STAGE.DRUM_ROLL);
});

test('reduceStart: requires compareGroupSlug', () => {
  const s = reduceUpload(initialState(), makeRows(3));
  assert.throws(() => reduceStart(s, { groupOverall: [] }), /compareGroupSlug/);
});

test('reduceAdvance: full ceremony for N=10 (outsiders 10,9; no batch_skipped)', () => {
  let s = reduceUpload(initialState(), makeRows(10));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [] });
  // OUTSIDERS, idx=0 → rank 10
  assert.equal(s.cursor.stage, STAGE.OUTSIDERS);
  s = reduceAdvance(s);
  // idx=1 → rank 9
  assert.equal(s.cursor.stage, STAGE.OUTSIDERS);
  assert.equal(s.cursor.outsidersIdx, 1);
  s = reduceAdvance(s);
  // outsiders done; skipped is empty → DRUM_ROLL
  assert.equal(s.cursor.stage, STAGE.DRUM_ROLL);
  s = reduceAdvance(s);
  assert.equal(s.cursor.stage, STAGE.TOP8);
  assert.equal(s.cursor.top8Rank, 8);
  for (let i = 0; i < 8 * 6; i++) {
    s = reduceAdvance(s);
  }
  assert.equal(s.phase, PHASE.FINISHED);
});

test('reduceAdvance: N=4 (no outsiders) full walk', () => {
  let s = reduceUpload(initialState(), makeRows(4));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [] });
  // start: DRUM_ROLL
  assert.equal(s.cursor.stage, STAGE.DRUM_ROLL);
  s = reduceAdvance(s);
  assert.equal(s.cursor.stage, STAGE.TOP8);
  assert.equal(s.cursor.top8Rank, 4);
  for (let i = 0; i < 4 * 6; i++) {
    s = reduceAdvance(s);
  }
  assert.equal(s.phase, PHASE.FINISHED);
});

test('reduceAdvance: N=11 walks all outsiders 11→10→9 then drum_roll', () => {
  let s = reduceUpload(initialState(), makeRows(11));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [] });
  assert.deepEqual(s.skipPlan.outsiders, [11, 10, 9]);
  assert.deepEqual(s.skipPlan.skipped, []);
  assert.equal(s.cursor.outsidersIdx, 0);
  s = reduceAdvance(s); assert.equal(s.cursor.outsidersIdx, 1);
  s = reduceAdvance(s); assert.equal(s.cursor.outsidersIdx, 2);
  s = reduceAdvance(s); assert.equal(s.cursor.stage, STAGE.DRUM_ROLL);
});

test('reduceAdvance: at FINISHED throws NOOP', () => {
  let s = reduceUpload(initialState(), makeRows(2));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [] });
  for (let i = 0; i < 100; i++) {
    if (s.phase === PHASE.FINISHED) break;
    s = reduceAdvance(s);
  }
  assert.equal(s.phase, PHASE.FINISHED);
  // one more advance from FINISHED = NOOP. But cursor.stage is FINISHED.
  // reduceAdvance refuses non-revealing phase.
  assert.throws(() => reduceAdvance(s), /cannot advance/);
});

test('reduceReset', () => {
  const s = reduceUpload(initialState(), makeRows(2));
  const s2 = reduceReset(s);
  assert.equal(s2.phase, PHASE.IDLE);
  assert.equal(s2.rows.length, 0);
});

// ---------- redact ----------

test('redact: idle leaks nothing', () => {
  const r = redact(initialState());
  assert.equal(r.phase, PHASE.IDLE);
  assert.equal(r.revealedRows.length, 0);
  assert.equal(r.currentTop8, null);
});

test('redact: uploaded leaks nothing', () => {
  let s = reduceUpload(initialState(), makeRows(5));
  const r = redact(s);
  assert.equal(r.phase, PHASE.UPLOADED);
  assert.equal(r.revealedRows.length, 0);
  assert.equal(r.currentTop8, null);
});

test('redact during OUTSIDERS shows current+previous outsiders only', () => {
  let s = reduceUpload(initialState(), makeRows(11));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [] });
  // outsiders=[11,10,9]. idx=0 → rank 11.
  let r = redact(s);
  assert.equal(r.revealedRows.length, 1);
  assert.equal(r.revealedRows[0].rank, 11);
  assert.equal(r.currentTop8, null);

  s = reduceAdvance(s); // idx=1 → rank 10
  r = redact(s);
  assert.equal(r.revealedRows.length, 2);
  s = reduceAdvance(s); // idx=2 → rank 9
  r = redact(s);
  assert.equal(r.revealedRows.length, 3);
});

test('redact during TOP8 partial reveal: place step exposes only rank', () => {
  let s = reduceUpload(initialState(), makeRows(8));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [] });
  s = reduceAdvance(s); // → TOP8 rank 8 step place
  const r = redact(s);
  assert.equal(r.currentTop8.rank, 8);
  assert.equal(r.currentTop8.fullName, undefined);
  assert.equal(r.currentTop8.points, undefined);
  assert.equal(r.currentTop8.bonus, undefined);
  assert.equal(r.currentTop8.publicPlaceInGroup, undefined);
});

test('redact during TOP8 progressive reveal', () => {
  let s = reduceUpload(initialState(), makeRows(8));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [{ kaggleId: 'u7', place: 5 }] });
  s = reduceAdvance(s); // → TOP8 step=place
  s = reduceAdvance(s); // dpublic
  let r = redact(s);
  assert.equal(typeof r.currentTop8.dPlace, 'number');
  assert.equal(r.currentTop8.bonus, undefined);
  s = reduceAdvance(s); // bonus
  r = redact(s);
  assert.equal(typeof r.currentTop8.bonus, 'number');
  assert.equal(r.currentTop8.points, undefined);
  s = reduceAdvance(s); // points
  r = redact(s);
  assert.equal(typeof r.currentTop8.points, 'number');
  assert.equal(r.currentTop8.fullName, undefined);
  s = reduceAdvance(s); // name
  r = redact(s);
  assert.equal(typeof r.currentTop8.fullName, 'string');
  assert.equal(r.currentTop8.nameAnimating, true);
});

test('redact never leaks kaggleId', () => {
  let s = reduceUpload(initialState(), makeRows(11));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [] });
  for (let i = 0; i < 30; i++) {
    if (s.phase === PHASE.FINISHED) break;
    const r = redact(s);
    const json = JSON.stringify(r);
    assert.equal(json.includes('kaggleId'), false, `step ${i}: leaked kaggleId. state=${json}`);
    s = reduceAdvance(s);
  }
});

test('redact at FINISHED returns full table', () => {
  let s = reduceUpload(initialState(), makeRows(3));
  s = reduceSetSettings(s, { compareGroupSlug: 'g' });
  s = reduceStart(s, { groupOverall: [] });
  while (s.phase !== PHASE.FINISHED) s = reduceAdvance(s);
  const r = redact(s);
  assert.equal(r.finalRows.length, 3);
  assert.equal(r.finalRows[0].rank, 1);
});

test('TOP8_STEPS sanity', () => {
  assert.deepEqual(TOP8_STEPS, ['place', 'dpublic', 'bonus', 'points', 'name', 'done']);
});
