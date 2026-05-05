import { Router } from 'express';
import path from 'node:path';
import { getCompetition } from '../db/competitionsRepo.js';
import {
  insertNativeTask,
  getNativeTask,
  listNativeTasks,
  updateNativeTask,
  softDeleteNativeTask,
} from '../db/nativeTasksRepo.js';
import {
  insertPendingFile,
  commitFilePath,
  getFileById,
  deleteFileById,
  updateFileMetadata,
} from '../db/nativeTaskFilesRepo.js';
import { acceptSingleFile } from '../upload/multipartFile.js';
import { safeFilename } from '../upload/safeFilename.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const NATIVE_DATA_DIR = () => path.resolve(process.env.NATIVE_DATA_DIR || './data/native');

function maxBytesFor(kind) {
  if (kind === 'dataset') return Number(process.env.MAX_DATASET_BYTES || 524288000);
  if (kind === 'artifact') return Number(process.env.MAX_ARTIFACT_BYTES || 26214400);
  return 0;
}

function fileDir(comp, task, kind) {
  return path.join(NATIVE_DATA_DIR(), comp, task, kind);
}

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

  router.put('/:taskSlug/files/:fileId', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const file = getFileById(db, Number(req.params.fileId));
    if (!file) return res.status(404).json({ error: 'file not found' });
    const patch = {};
    if ('displayName' in req.body) patch.displayName = String(req.body.displayName).trim();
    if ('description' in req.body) patch.description = String(req.body.description);
    if ('displayOrder' in req.body) patch.displayOrder = Number(req.body.displayOrder) || 0;
    const updated = updateFileMetadata(db, file.id, patch);
    res.json({ file: updated });
  });

  router.delete('/:taskSlug/files/:fileId', async (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const file = getFileById(db, Number(req.params.fileId));
    if (!file) return res.status(404).json({ error: 'file not found' });
    deleteFileById(db, file.id);
    try {
      const fsp = await import('node:fs/promises');
      await fsp.rm(file.path, { force: true });
    } catch (e) {
      console.warn(`[delete file] disk cleanup failed: ${e.message}`);
    }
    res.json({ ok: true });
  });

  router.post('/:taskSlug/files', (req, res) => {
    const r = requireNativeComp(db, req.params.competitionSlug);
    if (r.error) return res.status(r.error.status).json({ error: r.error.message });
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const kind = req.query.kind;
    if (kind !== 'dataset' && kind !== 'artifact') {
      return res.status(400).json({ error: "kind must be 'dataset' or 'artifact'" });
    }
    const destDir = fileDir(req.params.competitionSlug, req.params.taskSlug, kind);
    const maxBytes = maxBytesFor(kind);

    acceptSingleFile(req, res, {
      maxBytes,
      destDir,
      makeFinalName: (info) => `.pending-${Date.now()}-${safeFilename(info.filename)}`,
      onAccepted: async ({ size, sha256, finalPath, originalFilename, fields }) => {
        try {
          const displayName = String(fields?.display_name || originalFilename);
          const description = String(fields?.description || '');
          const row = insertPendingFile(db, {
            taskId: task.id,
            kind,
            displayName,
            description,
            originalFilename,
            sizeBytes: size,
            sha256,
          });
          const finalName = `${row.id}-${safeFilename(originalFilename)}`;
          const targetPath = path.join(destDir, finalName);
          const fsp = await import('node:fs/promises');
          try {
            await fsp.rename(finalPath, targetPath);
            commitFilePath(db, row.id, targetPath);
            res.json({ file: getFileById(db, row.id) });
          } catch (renameErr) {
            deleteFileById(db, row.id);
            await fsp.rm(finalPath, { force: true }).catch(() => {});
            res.status(500).json({ error: renameErr.message });
          }
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      },
      onError: (err, status) => res.status(status || 500).json({ error: err.message }),
    });
  });

  function singleSlotEndpoint(slot, pathField, maxEnvKey) {
    return (req, res) => {
      const r = requireNativeComp(db, req.params.competitionSlug);
      if (r.error) return res.status(r.error.status).json({ error: r.error.message });
      const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
      if (!task) return res.status(404).json({ error: 'task not found' });
      const taskDir = path.join(NATIVE_DATA_DIR(), req.params.competitionSlug, req.params.taskSlug);
      const fallback = slot === 'grader' ? 102400 : 524288000;
      const maxBytes = Number(process.env[maxEnvKey] || fallback);
      acceptSingleFile(req, res, {
        maxBytes,
        destDir: taskDir,
        makeFinalName: (info) => `.pending-${Date.now()}-${safeFilename(info.filename)}`,
        onAccepted: async ({ finalPath, originalFilename }) => {
          try {
            const ext = path.extname(originalFilename) || '';
            const target = path.join(taskDir, `${slot.replace(/-/g, '_')}${ext}`);
            const fsp = await import('node:fs/promises');
            const prevPath = task[pathField];
            if (prevPath && prevPath !== target) {
              await fsp.rm(prevPath, { force: true }).catch(() => {});
            }
            await fsp.rename(finalPath, target);
            updateNativeTask(db, req.params.competitionSlug, req.params.taskSlug, { [pathField]: target });
            res.json({ ok: true, path: target });
          } catch (e) {
            res.status(500).json({ error: e.message });
          }
        },
        onError: (err, status) => res.status(status || 500).json({ error: err.message }),
      });
    };
  }

  function deleteSlotEndpoint(pathField) {
    return async (req, res) => {
      const r = requireNativeComp(db, req.params.competitionSlug);
      if (r.error) return res.status(r.error.status).json({ error: r.error.message });
      const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
      if (!task) return res.status(404).json({ error: 'task not found' });
      if (task[pathField]) {
        const fsp = await import('node:fs/promises');
        await fsp.rm(task[pathField], { force: true }).catch(() => {});
      }
      updateNativeTask(db, req.params.competitionSlug, req.params.taskSlug, { [pathField]: null });
      res.json({ ok: true });
    };
  }

  router.put('/:taskSlug/grader', singleSlotEndpoint('grader', 'graderPath', 'MAX_GRADER_BYTES'));
  router.put('/:taskSlug/ground-truth', singleSlotEndpoint('ground-truth', 'groundTruthPath', 'MAX_GROUND_TRUTH_BYTES'));
  router.put('/:taskSlug/ground-truth-private', singleSlotEndpoint('ground-truth-private', 'groundTruthPrivatePath', 'MAX_GROUND_TRUTH_BYTES'));

  router.delete('/:taskSlug/grader', deleteSlotEndpoint('graderPath'));
  router.delete('/:taskSlug/ground-truth', deleteSlotEndpoint('groundTruthPath'));
  router.delete('/:taskSlug/ground-truth-private', deleteSlotEndpoint('groundTruthPrivatePath'));

  return router;
}
