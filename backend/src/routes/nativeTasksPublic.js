import { Router } from 'express';
import { getCompetition } from '../db/competitionsRepo.js';
import { getNativeTask, listNativeTasks } from '../db/nativeTasksRepo.js';
import { listFilesByTask, getFileById } from '../db/nativeTaskFilesRepo.js';
import { requireAuth } from '../auth/middleware.js';
import { streamZip } from '../upload/zipStream.js';

function stripPrivate(file) {
  return {
    id: file.id,
    kind: file.kind,
    displayName: file.displayName,
    description: file.description,
    originalFilename: file.originalFilename,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    displayOrder: file.displayOrder,
    uploadedAt: file.uploadedAt,
  };
}

function publicTask(task, files) {
  if (!task) return null;
  const datasets = files.filter((f) => f.kind === 'dataset').map(stripPrivate);
  const artifacts = files.filter((f) => f.kind === 'artifact').map(stripPrivate);
  return {
    slug: task.slug,
    title: task.title,
    descriptionMd: task.descriptionMd,
    higherIsBetter: task.higherIsBetter,
    baselineScorePublic: task.baselineScorePublic,
    authorScorePublic: task.authorScorePublic,
    baselineScorePrivate: task.baselineScorePrivate,
    authorScorePrivate: task.authorScorePrivate,
    datasets,
    artifacts,
  };
}

function requireNativeCompPublic(db, slug) {
  const c = getCompetition(db, slug);
  if (!c || c.deletedAt) return null;
  if (c.type !== 'native') return null;
  return c;
}

export function createNativeTasksPublicRouter({ db }) {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const c = requireNativeCompPublic(db, req.params.competitionSlug);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.json({
      tasks: listNativeTasks(db, req.params.competitionSlug).map((t) => ({
        slug: t.slug,
        title: t.title,
        higherIsBetter: t.higherIsBetter,
      })),
    });
  });

  router.get('/:taskSlug', (req, res) => {
    const c = requireNativeCompPublic(db, req.params.competitionSlug);
    if (!c) return res.status(404).json({ error: 'not found' });
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const files = listFilesByTask(db, task.id);
    res.json({ task: publicTask(task, files), updatedAt: task.createdAt });
  });

  router.get('/:taskSlug/files.zip', requireAuth, (req, res) => {
    const c = requireNativeCompPublic(db, req.params.competitionSlug);
    if (!c) return res.status(404).json({ error: 'not found' });
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const kind = req.query.kind;
    if (kind !== 'dataset' && kind !== 'artifact') {
      return res.status(400).json({ error: 'kind required' });
    }
    const files = listFilesByTask(db, task.id, kind);
    if (!files.length) return res.status(404).json({ error: 'no files' });
    streamZip(files, res, `${req.params.taskSlug}-${kind}`);
  });

  router.get('/:taskSlug/files/:fileId', requireAuth, (req, res) => {
    const c = requireNativeCompPublic(db, req.params.competitionSlug);
    if (!c) return res.status(404).json({ error: 'not found' });
    const file = getFileById(db, Number(req.params.fileId));
    if (!file) return res.status(404).json({ error: 'file not found' });
    if (file.kind !== 'dataset' && file.kind !== 'artifact') {
      return res.status(404).json({ error: 'file not found' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalFilename}"`);
    res.setHeader('Content-Length', String(file.sizeBytes));
    res.sendFile(file.path);
  });

  return router;
}
