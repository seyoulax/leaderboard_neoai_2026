import { Router } from 'express';
import { getCompetition } from '../db/competitionsRepo.js';
import {
  insertNativeTask,
  getNativeTask,
  listNativeTasks,
  updateNativeTask,
  softDeleteNativeTask,
} from '../db/nativeTasksRepo.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function requireNativeComp(db, slug) {
  const c = getCompetition(db, slug);
  if (!c) return { error: { status: 404, message: `competition '${slug}' not found` } };
  if (c.deletedAt) return { error: { status: 404, message: `competition '${slug}' is deleted` } };
  if (c.type !== 'native') return { error: { status: 400, message: `competition '${slug}' is not native` } };
  return { competition: c };
}

function validateTaskInput(b) {
  const errors = [];
  const slug = String(b?.slug || '').trim().toLowerCase();
  const title = String(b?.title || '').trim();
  if (!slug || slug.length > 64 || !SLUG_RE.test(slug)) errors.push('invalid slug');
  if (!title || title.length > 200) errors.push('invalid title');
  const descriptionMd = String(b?.descriptionMd ?? '');
  const higherIsBetter = b?.higherIsBetter !== false;
  const numeric = (k) => {
    if (b?.[k] === undefined || b?.[k] === null || b?.[k] === '') return null;
    const n = Number(b[k]);
    if (!Number.isFinite(n)) errors.push(`${k}: not a number`);
    return n;
  };
  return {
    ok: errors.length === 0,
    errors,
    data: {
      slug,
      title,
      descriptionMd,
      higherIsBetter,
      baselineScorePublic: numeric('baselineScorePublic'),
      authorScorePublic: numeric('authorScorePublic'),
      baselineScorePrivate: numeric('baselineScorePrivate'),
      authorScorePrivate: numeric('authorScorePrivate'),
    },
  };
}

export function createNativeTasksAdminRouter({ db }) {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    res.json({ tasks: listNativeTasks(db, req.params.competitionSlug) });
  });

  router.post('/', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const v = validateTaskInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });
    if (getNativeTask(db, req.params.competitionSlug, v.data.slug)) {
      return res.status(400).json({ error: `slug '${v.data.slug}' already exists` });
    }
    const task = insertNativeTask(db, { competitionSlug: req.params.competitionSlug, ...v.data });
    res.json({ task });
  });

  router.put('/:taskSlug', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const existing = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!existing) return res.status(404).json({ error: 'task not found' });
    const v = validateTaskInput({ ...existing, ...req.body, slug: existing.slug });
    if (!v.ok) return res.status(400).json({ error: v.errors.join('; ') });
    const { slug, ...patch } = v.data;
    const task = updateNativeTask(db, req.params.competitionSlug, req.params.taskSlug, patch);
    res.json({ task });
  });

  router.delete('/:taskSlug', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const existing = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!existing) return res.status(404).json({ error: 'task not found' });
    softDeleteNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    res.json({ ok: true });
  });

  return router;
}
