import { Router } from 'express';
import { getCompetition } from '../db/competitionsRepo.js';
import { getNativeTask } from '../db/nativeTasksRepo.js';
import {
  listSubmissionsForTask,
  getSubmission,
  resetSubmissionForRescore,
  resetAllForRescore,
  deleteSubmission,
} from '../db/submissionsRepo.js';

export function createSubmissionsAdminRouter({ db }) {
  const router = Router({ mergeParams: true });

  function requireNativeTask(req, res) {
    const c = getCompetition(db, req.params.competitionSlug);
    if (!c || c.deletedAt || c.type !== 'native') {
      res.status(404).json({ error: 'not found' });
      return null;
    }
    const task = getNativeTask(db, req.params.competitionSlug, req.params.taskSlug);
    if (!task) {
      res.status(404).json({ error: 'task not found' });
      return null;
    }
    return task;
  }

  router.get('/', (req, res) => {
    const task = requireNativeTask(req, res);
    if (!task) return;
    const status = req.query.status || null;
    const list = listSubmissionsForTask(db, { taskId: task.id, status });
    res.json({ submissions: list });
  });

  // /rescore-all ДО /:id чтобы избежать коллизии маршрутов
  router.post('/rescore-all', (req, res) => {
    const task = requireNativeTask(req, res);
    if (!task) return;
    const reset = resetAllForRescore(db, task.id);
    res.json({ ok: true, reset });
  });

  router.post('/:id/rescore', (req, res) => {
    const task = requireNativeTask(req, res);
    if (!task) return;
    const sub = getSubmission(db, Number(req.params.id));
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.taskId !== task.id) return res.status(404).json({ error: 'not found' });
    resetSubmissionForRescore(db, sub.id);
    res.json({ ok: true, submission: getSubmission(db, sub.id) });
  });

  router.delete('/:id', async (req, res) => {
    const task = requireNativeTask(req, res);
    if (!task) return;
    const sub = getSubmission(db, Number(req.params.id));
    if (!sub) return res.status(404).json({ error: 'not found' });
    if (sub.taskId !== task.id) return res.status(404).json({ error: 'not found' });
    deleteSubmission(db, sub.id);
    try {
      const fsp = await import('node:fs/promises');
      await fsp.rm(sub.path, { force: true });
    } catch (e) {
      console.warn(`[admin/sub delete] disk cleanup failed: ${e.message}`);
    }
    res.json({ ok: true });
  });

  return router;
}
