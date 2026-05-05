import { Router } from 'express';
import path from 'node:path';
import { acceptSingleFile } from '../upload/multipartFile.js';
import { safeFilename } from '../upload/safeFilename.js';
import { getCompetition } from '../db/competitionsRepo.js';
import { getNativeTask } from '../db/nativeTasksRepo.js';
import {
  insertSubmission,
  getSubmission,
  listSubmissionsForUserTask,
  countRecentSubmissions,
  deleteSubmission,
  setSubmissionSelected,
  countSelectedForUserTask,
} from '../db/submissionsRepo.js';
import { requireAuth } from '../auth/middleware.js';

const NATIVE_DATA_DIR = () => path.resolve(process.env.NATIVE_DATA_DIR || './data/native');
const ALLOWED_EXTS = () => (process.env.SUBMISSION_ALLOWED_EXTS || 'csv,tsv,json').split(',').map((s) => s.trim().toLowerCase());
const MAX_BYTES = () => Number(process.env.MAX_SUBMISSION_BYTES || 52_428_800);
const MAX_PER_DAY = () => Number(process.env.MAX_SUBMISSIONS_PER_DAY || 50);

function subDir(comp, task) {
  return path.join(NATIVE_DATA_DIR(), comp, task, 'submissions');
}

function autoJoin(db, compSlug, userId) {
  db.prepare(`INSERT OR IGNORE INTO competition_members (competition_slug, user_id) VALUES (?, ?)`).run(compSlug, userId);
}

export function publicSubmission(s) {
  if (!s) return null;
  return {
    id: s.id, taskId: s.taskId, status: s.status,
    originalFilename: s.originalFilename, sizeBytes: s.sizeBytes,
    rawScorePublic: s.rawScorePublic, rawScorePrivate: s.rawScorePrivate,
    pointsPublic: s.pointsPublic, pointsPrivate: s.pointsPrivate,
    errorMessage: s.errorMessage, logExcerpt: s.logExcerpt,
    durationMs: s.durationMs, attempts: s.attempts,
    selected: s.selected,
    createdAt: s.createdAt, scoredAt: s.scoredAt,
  };
}

export function createSubmissionsPublicRouter({ db }) {
  const router = Router({ mergeParams: true });

  router.post('/', requireAuth, async (req, res) => {
    const compSlug = req.params.competitionSlug;
    const taskSlug = req.params.taskSlug;
    const c = getCompetition(db, compSlug);
    if (!c || c.deletedAt || c.type !== 'native') return res.status(404).json({ error: 'not found' });
    const task = getNativeTask(db, compSlug, taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });

    const recent = countRecentSubmissions(db, { userId: req.user.id, taskId: task.id, hours: 24 });
    if (recent >= MAX_PER_DAY()) {
      return res.status(429).json({ error: `rate limit: max ${MAX_PER_DAY()} submissions per 24h per task`, recent });
    }

    const allowedExts = ALLOWED_EXTS();
    const destDir = subDir(compSlug, taskSlug);

    acceptSingleFile(req, res, {
      maxBytes: MAX_BYTES(),
      destDir,
      makeFinalName: (info) => `.pending-${Date.now()}-${safeFilename(info.filename)}`,
      onAccepted: async ({ size, sha256, finalPath, originalFilename }) => {
        try {
          const ext = (originalFilename.split('.').pop() || '').toLowerCase();
          const fsp = await import('node:fs/promises');
          if (!allowedExts.includes(ext)) {
            await fsp.rm(finalPath, { force: true });
            return res.status(400).json({ error: `extension .${ext} not in whitelist (${allowedExts.join(',')})` });
          }
          autoJoin(db, compSlug, req.user.id);
          const row = insertSubmission(db, {
            taskId: task.id, userId: req.user.id,
            originalFilename, sizeBytes: size, sha256,
            path: '',
          });
          const finalName = `${row.id}-${safeFilename(originalFilename)}`;
          const targetPath = path.join(destDir, finalName);
          try {
            await fsp.rename(finalPath, targetPath);
            db.prepare('UPDATE submissions SET path = ? WHERE id = ?').run(targetPath, row.id);
            res.json({ submission: publicSubmission(getSubmission(db, row.id)) });
          } catch (e) {
            deleteSubmission(db, row.id);
            await fsp.rm(finalPath, { force: true }).catch(() => {});
            res.status(500).json({ error: e.message });
          }
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      },
      onError: (err, status) => res.status(status || 500).json({ error: err.message }),
    });
  });

  router.get('/me', requireAuth, (req, res) => {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt || c.type !== 'native') return res.status(404).json({ error: 'not found' });
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) return res.status(404).json({ error: 'task not found' });
    const list = listSubmissionsForUserTask(db, { userId: req.user.id, taskId: task.id });
    res.json({ submissions: list.map(publicSubmission) });
  });

  router.put('/:id/select', requireAuth, (req, res) => {
    const sub = getSubmission(db, Number(req.params.id));
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.userId !== req.user.id) return res.status(404).json({ error: 'not found' });
    if (sub.status !== 'scored') return res.status(400).json({ error: 'submission not scored yet' });
    if (typeof req.body?.selected !== 'boolean') {
      return res.status(400).json({ error: 'body.selected must be a boolean' });
    }
    const selected = req.body.selected;
    if (selected && sub.selected === 0) {
      const count = countSelectedForUserTask(db, req.user.id, sub.taskId);
      if (count >= 2) {
        return res.status(400).json({ error: 'max 2 selected per task; unselect another first' });
      }
    }
    setSubmissionSelected(db, sub.id, selected);
    res.json({ submission: { id: sub.id, selected: selected ? 1 : 0 } });
  });

  router.get('/:id', requireAuth, (req, res) => {
    const sub = getSubmission(db, Number(req.params.id));
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.userId !== req.user.id && req.user.role !== 'admin') return res.status(404).json({ error: 'not found' });
    res.json({ submission: publicSubmission(sub) });
  });

  return router;
}
