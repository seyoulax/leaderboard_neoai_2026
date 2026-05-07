import { Router } from 'express';
import {
  parseResultsCsv,
  reduceUpload,
  reduceSetSettings,
  reduceStart,
  reduceAdvance,
  reduceReset,
  redact,
  PHASE,
} from '../results.js';

// Public routes for the results-reveal ceremony.
// Mounted at /api/competitions/:competitionSlug/results
export function createResultsPublicRouter({ store, requireCompetition }) {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    if (!requireCompetition(req, res)) return;
    const state = await store.getState(req.params.competitionSlug);
    res.json(redact(state));
  });

  router.get('/stream', async (req, res) => {
    if (!requireCompetition(req, res)) return;
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const slug = req.params.competitionSlug;
    let closed = false;

    const send = (state) => {
      if (closed) return;
      try {
        res.write(`id: ${state.stepId}\nevent: state\ndata: ${JSON.stringify(redact(state))}\n\n`);
      } catch { /* ignore */ }
    };

    // initial push
    const current = await store.getState(slug);
    send(current);

    const unsub = store.subscribe(slug, send);

    const heartbeat = setInterval(() => {
      if (closed) return;
      try { res.write(`: ping ${Date.now()}\n\n`); } catch { /* ignore */ }
    }, 25_000);

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsub();
    });
  });

  return router;
}

// Admin routes. Mounted at /api/admin/competitions/:competitionSlug/results
export function createResultsAdminRouter({ store, requireCompetition, getGroupOverall }) {
  const router = Router({ mergeParams: true });

  router.get('/', async (req, res) => {
    if (!requireCompetition(req, res)) return;
    const state = await store.getState(req.params.competitionSlug);
    // Admin gets full state (rows include kaggleId).
    res.json(state);
  });

  router.put('/upload', async (req, res) => {
    if (!requireCompetition(req, res)) return;
    const slug = req.params.competitionSlug;
    try {
      const text = await readCsvBody(req);
      let rows;
      try { rows = parseResultsCsv(text); }
      catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
      let saved;
      try {
        saved = await store.update(slug, (cur) => reduceUpload(cur, rows));
      } catch (e) { return res.status(e.statusCode || 500).json({ error: e.message }); }
      await store.saveCsvText(slug, text);
      res.json(saved);
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  router.put('/settings', async (req, res) => {
    if (!requireCompetition(req, res)) return;
    const slug = req.params.competitionSlug;
    const patch = {};
    if (req.body?.compareGroupSlug !== undefined) {
      const v = String(req.body.compareGroupSlug || '').toLowerCase().trim();
      if (!v) return res.status(400).json({ error: 'compareGroupSlug required' });
      patch.compareGroupSlug = v;
    }
    if (req.body?.compareSource !== undefined) {
      patch.compareSource = String(req.body.compareSource || '').trim();
    }
    try {
      const next = await store.update(slug, (cur) => reduceSetSettings(cur, patch));
      res.json(next);
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  router.post('/start', async (req, res) => {
    if (!requireCompetition(req, res)) return;
    const slug = req.params.competitionSlug;
    try {
      const cur = await store.getState(slug);
      if (cur.phase !== PHASE.UPLOADED) return res.status(409).json({ error: `cannot start from phase ${cur.phase}` });
      if (!cur.compareGroupSlug) return res.status(409).json({ error: 'compareGroupSlug not set' });
      const groupOverall = await getGroupOverall(slug, cur.compareGroupSlug, cur.compareSource || 'overall');
      const next = await store.update(slug, (s) => reduceStart(s, { groupOverall }));
      res.json(next);
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  router.post('/advance', async (req, res) => {
    if (!requireCompetition(req, res)) return;
    const slug = req.params.competitionSlug;
    const expected = req.body?.expectedStepId;
    try {
      const next = await store.update(slug, (cur) => {
        if (typeof expected === 'number' && expected !== cur.stepId) {
          const err = new Error(`stepId mismatch (expected ${expected}, current ${cur.stepId})`);
          err.statusCode = 409;
          throw err;
        }
        return reduceAdvance(cur);
      });
      res.json(next);
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  router.post('/reset', async (req, res) => {
    if (!requireCompetition(req, res)) return;
    const slug = req.params.competitionSlug;
    try {
      await store.reset(slug);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });

  return router;
}

// Reads the request body as CSV text. Accepts either JSON `{csv: string}` or raw `text/csv`.
// Frontend reads the file via FileReader and POSTs as JSON — keeps things simple.
async function readCsvBody(req) {
  const ct = String(req.get('content-type') || '').toLowerCase();
  if (ct.startsWith('application/json')) {
    const text = req.body?.csv;
    if (typeof text !== 'string') {
      const err = new Error('expected JSON body { csv: string }'); err.statusCode = 400; throw err;
    }
    return text;
  }
  // Fallback: read raw body
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { data += chunk; if (data.length > 50 * 1024 * 1024) { reject(Object.assign(new Error('csv too large'), { statusCode: 413 })); req.destroy(); }});
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
