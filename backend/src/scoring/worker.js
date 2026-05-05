import { runGrader } from './runGrader.js';
import { computePoints } from './computePoints.js';
import {
  pickAndMarkScoring,
  markScored,
  markFailed,
  markFailedRetry,
  recoverStale,
} from '../db/submissionsRepo.js';
import { getNativeTaskById } from '../db/nativeTasksRepo.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_LOG_BYTES = 8192;

export async function tick(db, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.SCORING_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  recoverStale(db);
  const sub = pickAndMarkScoring(db);
  if (!sub) return;
  const task = getNativeTaskById(db, sub.taskId);
  if (!task) return markFailed(db, sub.id, { error: 'task missing', log: '', durationMs: 0 });
  if (!task.graderPath) return markFailed(db, sub.id, { error: 'grader not configured', log: '', durationMs: 0 });
  if (!task.groundTruthPath) return markFailed(db, sub.id, { error: 'public ground_truth not configured', log: '', durationMs: 0 });

  try {
    const pub = await runGrader({
      graderPath: task.graderPath,
      gtPath: task.groundTruthPath,
      subPath: sub.path,
      timeoutMs,
    });
    const pointsPublic = computePoints({
      raw: pub.rawScore,
      baseline: task.baselineScorePublic,
      author: task.authorScorePublic,
      higherIsBetter: task.higherIsBetter,
    });

    let rawScorePrivate = null;
    let pointsPrivate = null;
    let privateLog = '(no private GT configured)';
    let privateDurationMs = 0;
    if (task.groundTruthPrivatePath) {
      try {
        const priv = await runGrader({
          graderPath: task.graderPath,
          gtPath: task.groundTruthPrivatePath,
          subPath: sub.path,
          timeoutMs,
        });
        rawScorePrivate = priv.rawScore;
        pointsPrivate = computePoints({
          raw: priv.rawScore,
          baseline: task.baselineScorePrivate,
          author: task.authorScorePrivate,
          higherIsBetter: task.higherIsBetter,
        });
        privateLog = priv.log;
        privateDurationMs = priv.durationMs;
      } catch (e) {
        privateLog = `[private failed] ${e.error}\n${e.log || ''}`;
        privateDurationMs = e.durationMs || 0;
      }
    }

    const log = `--- public ---\n${pub.log}\n--- private ---\n${privateLog}`.slice(-MAX_LOG_BYTES);
    markScored(db, sub.id, {
      rawScorePublic: pub.rawScore,
      rawScorePrivate,
      pointsPublic,
      pointsPrivate,
      log,
      durationMs: pub.durationMs + privateDurationMs,
    });
  } catch (e) {
    handleFailure(db, sub, e);
  }
}

function handleFailure(db, sub, e) {
  const willExceedBudget = sub.attempts + 1 >= MAX_ATTEMPTS;
  if (willExceedBudget) markFailed(db, sub.id, e);
  else markFailedRetry(db, sub.id, e);
}

export function startWorker(db, { intervalMs } = {}) {
  const ms = intervalMs ?? Number(process.env.WORKER_TICK_MS || 2000);
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(db); } catch (err) { console.error('[worker] tick error', err); }
    finally { running = false; }
  }, ms);
  return () => clearInterval(timer);
}
