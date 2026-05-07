// Pure logic for the results-reveal ceremony. No I/O.
// See docs/superpowers/specs/2026-05-07-results-reveal-ceremony-design.md

export const PHASE = Object.freeze({
  IDLE: 'idle',
  UPLOADED: 'uploaded',
  REVEALING: 'revealing',
  FINISHED: 'finished',
});

export const STAGE = Object.freeze({
  IDLE: 'idle',
  OUTSIDERS: 'outsiders',
  BATCH_SKIPPED: 'batch_skipped',
  DRUM_ROLL: 'drum_roll',
  TOP8: 'top8',
  FINISHED: 'finished',
});

export const TOP8_STEPS = Object.freeze(['place', 'dpublic', 'bonus', 'points', 'name', 'done']);

export function initialState() {
  return {
    version: 1,
    phase: PHASE.IDLE,
    compareGroupSlug: null,
    rows: [],
    skipPlan: { outsiders: [], skipped: [] },
    cursor: { stage: STAGE.IDLE, outsidersIdx: -1, top8Rank: 0, top8Step: 'place' },
    createdAt: null,
    startedAt: null,
    updatedAt: null,
    stepId: 0,
  };
}

const HEADER_ALIASES = {
  kaggleid: 'kaggleId',
  kaggle_id: 'kaggleId',
  nick: 'kaggleId',
  nickname: 'kaggleId',
  fullname: 'fullName',
  full_name: 'fullName',
  name: 'fullName',
  fio: 'fullName',
  points: 'points',
  score: 'points',
  points_total: 'points',
  total: 'points',
  bonus: 'bonus',
  bonus_points: 'bonus',
};

function detectSeparator(headerLine) {
  const semi = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  return semi > comma ? ';' : ',';
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function splitCsvLine(line, sep) {
  // Tiny CSV split with double-quote support.
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else { cur += c; }
    } else if (c === '"') {
      inQ = true;
    } else if (c === sep) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

export function parseResultsCsv(text) {
  if (typeof text !== 'string') throw new Error('text must be string');
  const stripped = stripBom(text).replace(/\r\n?/g, '\n');
  const rawLines = stripped.split('\n');
  // strip trailing empty lines
  while (rawLines.length && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();
  if (rawLines.length === 0) {
    const err = new Error('csv: empty file');
    err.statusCode = 400;
    throw err;
  }
  const sep = detectSeparator(rawLines[0]);
  const header = splitCsvLine(rawLines[0], sep).map((h) => HEADER_ALIASES[h.toLowerCase()] || h);
  const idxKaggle = header.indexOf('kaggleId');
  const idxName = header.indexOf('fullName');
  const idxPoints = header.indexOf('points');
  const idxBonus = header.indexOf('bonus');
  if (idxKaggle === -1 || idxName === -1 || idxPoints === -1) {
    const err = new Error(`csv: missing required columns (kaggleId, fullName, points). Got: ${header.join(',')}`);
    err.statusCode = 400;
    throw err;
  }

  const rows = [];
  const seen = new Set();
  for (let li = 1; li < rawLines.length; li++) {
    const raw = rawLines[li];
    if (raw.trim() === '') continue;
    const cells = splitCsvLine(raw, sep);
    const kaggleId = String(cells[idxKaggle] || '').toLowerCase().trim();
    const fullName = String(cells[idxName] || '').trim();
    const pointsStr = String(cells[idxPoints] || '').replace(',', '.').trim();
    const bonusStr = idxBonus === -1 ? '0' : String(cells[idxBonus] || '0').replace(',', '.').trim();
    const points = Number(pointsStr);
    const bonus = Number(bonusStr || '0');
    if (!kaggleId) {
      const err = new Error(`csv line ${li + 1}: empty kaggleId`); err.statusCode = 400; throw err;
    }
    if (!fullName) {
      const err = new Error(`csv line ${li + 1}: empty fullName`); err.statusCode = 400; throw err;
    }
    if (!Number.isFinite(points)) {
      const err = new Error(`csv line ${li + 1}: invalid points "${pointsStr}"`); err.statusCode = 400; throw err;
    }
    if (!Number.isFinite(bonus)) {
      const err = new Error(`csv line ${li + 1}: invalid bonus "${bonusStr}"`); err.statusCode = 400; throw err;
    }
    if (seen.has(kaggleId)) {
      const err = new Error(`csv line ${li + 1}: duplicate kaggleId "${kaggleId}"`); err.statusCode = 400; throw err;
    }
    seen.add(kaggleId);
    rows.push({ kaggleId, fullName, points, bonus });
  }

  if (rows.length === 0) {
    const err = new Error('csv: no data rows'); err.statusCode = 400; throw err;
  }

  rows.sort((a, b) => (b.points + b.bonus) - (a.points + a.bonus));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

export function computeSkipPlan(N) {
  if (N <= 8) return { outsiders: [], skipped: [] };
  const outsiders = [];
  const skipped = [];
  for (let r = N; r >= 9; r--) {
    // Visible (one-by-one): even step from N. r in (N, N-2, ...)
    if ((N - r) % 2 === 0) outsiders.push(r);
    else skipped.push(r);
  }
  return { outsiders, skipped };
}

export function computePublicPlaces(rows, groupOverall) {
  const placeByKaggle = new Map();
  if (Array.isArray(groupOverall)) {
    groupOverall.forEach((entry, idx) => {
      const kid = String(entry.kaggleId || entry.nickname || '').toLowerCase().trim();
      if (!kid) return;
      const place = entry.place ?? (idx + 1);
      if (!placeByKaggle.has(kid)) placeByKaggle.set(kid, place);
    });
  }
  return rows.map((r) => ({
    ...r,
    publicPlaceInGroup: placeByKaggle.has(r.kaggleId) ? placeByKaggle.get(r.kaggleId) : null,
  }));
}

export function reduceUpload(state, rows) {
  if (state.phase === PHASE.REVEALING || state.phase === PHASE.FINISHED) {
    const err = new Error('cannot upload while ceremony in progress'); err.statusCode = 409; throw err;
  }
  return {
    ...initialState(),
    phase: PHASE.UPLOADED,
    rows,
    compareGroupSlug: state.compareGroupSlug || null,
    createdAt: state.createdAt || nowIso(),
    updatedAt: nowIso(),
    stepId: state.stepId + 1,
  };
}

export function reduceSetSettings(state, { compareGroupSlug }) {
  if (state.phase === PHASE.REVEALING || state.phase === PHASE.FINISHED) {
    const err = new Error('cannot change settings during ceremony'); err.statusCode = 409; throw err;
  }
  if (typeof compareGroupSlug !== 'string' || !compareGroupSlug) {
    const err = new Error('compareGroupSlug required'); err.statusCode = 400; throw err;
  }
  return {
    ...state,
    compareGroupSlug,
    updatedAt: nowIso(),
    stepId: state.stepId + 1,
  };
}

export function reduceStart(state, { groupOverall }) {
  if (state.phase !== PHASE.UPLOADED) {
    const err = new Error(`cannot start from phase ${state.phase}`); err.statusCode = 409; throw err;
  }
  if (!state.compareGroupSlug) {
    const err = new Error('compareGroupSlug not set'); err.statusCode = 409; throw err;
  }
  const rowsWithPlaces = computePublicPlaces(state.rows, groupOverall || []);
  const N = rowsWithPlaces.length;
  const skipPlan = computeSkipPlan(N);
  // Initial cursor depends on whether outsiders exist.
  let cursor;
  if (skipPlan.outsiders.length > 0) {
    cursor = { stage: STAGE.OUTSIDERS, outsidersIdx: 0, top8Rank: 0, top8Step: 'place' };
  } else {
    cursor = { stage: STAGE.DRUM_ROLL, outsidersIdx: -1, top8Rank: 0, top8Step: 'place' };
  }
  return {
    ...state,
    phase: PHASE.REVEALING,
    rows: rowsWithPlaces,
    skipPlan,
    cursor,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    stepId: state.stepId + 1,
  };
}

export function reduceAdvance(state) {
  if (state.phase !== PHASE.REVEALING) {
    const err = new Error(`cannot advance from phase ${state.phase}`); err.statusCode = 409; throw err;
  }
  const c = state.cursor;
  const next = { ...state, updatedAt: nowIso(), stepId: state.stepId + 1 };

  if (c.stage === STAGE.OUTSIDERS) {
    const nextIdx = c.outsidersIdx + 1;
    if (nextIdx < state.skipPlan.outsiders.length) {
      next.cursor = { ...c, outsidersIdx: nextIdx };
    } else {
      // outsiders done; either show batch_skipped (if any) or jump to drum_roll
      if (state.skipPlan.skipped.length > 0) {
        next.cursor = { stage: STAGE.BATCH_SKIPPED, outsidersIdx: c.outsidersIdx, top8Rank: 0, top8Step: 'place' };
      } else {
        next.cursor = { stage: STAGE.DRUM_ROLL, outsidersIdx: c.outsidersIdx, top8Rank: 0, top8Step: 'place' };
      }
    }
    return next;
  }

  if (c.stage === STAGE.BATCH_SKIPPED) {
    next.cursor = { ...c, stage: STAGE.DRUM_ROLL };
    return next;
  }

  if (c.stage === STAGE.DRUM_ROLL) {
    const startRank = Math.min(8, state.rows.length);
    if (startRank === 0) {
      // edge: no rows? shouldn't happen since upload rejects empty.
      next.phase = PHASE.FINISHED;
      next.cursor = { ...c, stage: STAGE.FINISHED };
      return next;
    }
    next.cursor = { stage: STAGE.TOP8, outsidersIdx: c.outsidersIdx, top8Rank: startRank, top8Step: 'place' };
    return next;
  }

  if (c.stage === STAGE.TOP8) {
    const stepIdx = TOP8_STEPS.indexOf(c.top8Step);
    if (stepIdx === -1) {
      const err = new Error(`invalid top8Step ${c.top8Step}`); err.statusCode = 500; throw err;
    }
    if (c.top8Step !== 'done') {
      const nextStep = TOP8_STEPS[stepIdx + 1];
      next.cursor = { ...c, top8Step: nextStep };
      return next;
    }
    // done → next rank or finished
    const nextRank = c.top8Rank - 1;
    if (nextRank < 1) {
      next.phase = PHASE.FINISHED;
      next.cursor = { ...c, stage: STAGE.FINISHED, top8Rank: 0, top8Step: 'place' };
      return next;
    }
    next.cursor = { ...c, top8Rank: nextRank, top8Step: 'place' };
    return next;
  }

  if (c.stage === STAGE.FINISHED) {
    const err = new Error('already finished'); err.code = 'NOOP'; err.statusCode = 409; throw err;
  }

  const err = new Error(`unknown stage ${c.stage}`); err.statusCode = 500; throw err;
}

export function reduceReset(_state) {
  return { ...initialState(), updatedAt: nowIso() };
}

// Build the public-facing redacted view of state. Never leaks unrevealed data.
export function redact(state) {
  const base = {
    phase: state.phase,
    stepId: state.stepId,
    compareGroupSlug: state.compareGroupSlug || null,
    revealedRows: [],
    skippedRows: null,
    currentTop8: null,
    drumRoll: false,
    finalRows: null,
    totalRanks: state.rows.length,
  };

  if (state.phase === PHASE.IDLE || state.phase === PHASE.UPLOADED) {
    return base;
  }

  // Helper: exposed view of a row with public-place comparison.
  const view = (row) => ({
    rank: row.rank,
    fullName: row.fullName,
    points: row.points,
    bonus: row.bonus,
    publicPlaceInGroup: row.publicPlaceInGroup ?? null,
    dPlace: row.publicPlaceInGroup == null ? null : (row.publicPlaceInGroup - row.rank),
  });

  const c = state.cursor;
  const rowByRank = new Map(state.rows.map((r) => [r.rank, r]));

  if (state.phase === PHASE.FINISHED) {
    base.finalRows = state.rows.slice().sort((a, b) => a.rank - b.rank).map(view);
    return base;
  }

  // REVEALING phase — collect already-revealed outsiders + batch + finished top-8 cards.
  const revealed = [];
  // Outsiders fully revealed = those at indices [0..outsidersIdx] when stage is past their reveal.
  // During OUTSIDERS stage, the row at `outsidersIdx` is the CURRENT (just shown). Treat it as revealed.
  if (c.stage === STAGE.OUTSIDERS) {
    for (let i = 0; i <= c.outsidersIdx; i++) {
      const r = rowByRank.get(state.skipPlan.outsiders[i]);
      if (r) revealed.push(view(r));
    }
  } else if (c.stage !== STAGE.IDLE) {
    // All outsiders past
    for (const rank of state.skipPlan.outsiders) {
      const r = rowByRank.get(rank);
      if (r) revealed.push(view(r));
    }
  }
  // Top-8 ranks already finished (top8Step=done means current rank also done; but during TOP8
  // the current rank is still ongoing — only ranks > current top8Rank are fully done).
  if (c.stage === STAGE.TOP8) {
    const startRank = Math.min(8, state.rows.length);
    for (let r = startRank; r > c.top8Rank; r--) {
      const row = rowByRank.get(r);
      if (row) revealed.push(view(row));
    }
  } else if (c.stage === STAGE.FINISHED) {
    // already covered in PHASE.FINISHED branch above
  }
  // sort: descending by rank (newest reveal at bottom of "going to top" — we'll sort ascending here
  // and let frontend decide order). Spec: ledger newest-on-top → frontend reverses.
  revealed.sort((a, b) => b.rank - a.rank);
  base.revealedRows = revealed;

  // batch_skipped reveal: once we've passed the BATCH_SKIPPED tick, expose the skipped rows.
  if (
    c.stage === STAGE.DRUM_ROLL ||
    c.stage === STAGE.TOP8 ||
    c.stage === STAGE.FINISHED ||
    c.stage === STAGE.BATCH_SKIPPED
  ) {
    if (state.skipPlan.skipped.length > 0) {
      base.skippedRows = state.skipPlan.skipped
        .map((rank) => rowByRank.get(rank))
        .filter(Boolean)
        .map(view)
        .sort((a, b) => b.rank - a.rank);
    } else {
      base.skippedRows = [];
    }
  }

  // drum-roll splash
  if (c.stage === STAGE.DRUM_ROLL) base.drumRoll = true;

  // current top-8 partial reveal
  if (c.stage === STAGE.TOP8) {
    const row = rowByRank.get(c.top8Rank);
    if (row) {
      const partial = { rank: row.rank };
      const stepIdx = TOP8_STEPS.indexOf(c.top8Step);
      // At step 'place' — only rank shown. Then progressively reveal.
      if (stepIdx >= TOP8_STEPS.indexOf('dpublic')) {
        partial.publicPlaceInGroup = row.publicPlaceInGroup ?? null;
        partial.dPlace = row.publicPlaceInGroup == null ? null : (row.publicPlaceInGroup - row.rank);
      }
      if (stepIdx >= TOP8_STEPS.indexOf('bonus')) partial.bonus = row.bonus;
      if (stepIdx >= TOP8_STEPS.indexOf('points')) partial.points = row.points;
      if (stepIdx >= TOP8_STEPS.indexOf('name')) {
        partial.fullName = row.fullName;
        partial.nameAnimating = c.top8Step === 'name';
      }
      partial.step = c.top8Step;
      base.currentTop8 = partial;
    }
  }

  return base;
}

function nowIso() {
  return new Date().toISOString();
}
