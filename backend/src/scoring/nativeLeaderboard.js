import { listNativeTasks } from '../db/nativeTasksRepo.js';
import { getBonusPointsByUserId } from '../db/membersRepo.js';

export function buildNativeLeaderboard(db, competitionSlug, variant) {
  const tasks = listNativeTasks(db, competitionSlug);
  const taskIds = tasks.map((t) => t.id);
  if (taskIds.length === 0) {
    return emptyResponse(tasks);
  }
  const bonusByUserId = getBonusPointsByUserId(db, competitionSlug);
  const placeholders = taskIds.map(() => '?').join(',');

  let rows;
  if (variant === 'private') {
    rows = db.prepare(
      `WITH selected_best AS (
         SELECT s.task_id, s.user_id, s.points_private AS points, s.raw_score_private AS raw_score, s.created_at,
                ROW_NUMBER() OVER (PARTITION BY s.task_id, s.user_id ORDER BY s.points_private DESC, s.id ASC) AS rn
         FROM submissions s
         WHERE s.status='scored' AND s.points_private IS NOT NULL AND s.selected = 1
           AND s.task_id IN (${placeholders})
       ),
       overall_best AS (
         SELECT s.task_id, s.user_id, s.points_private AS points, s.raw_score_private AS raw_score, s.created_at,
                ROW_NUMBER() OVER (PARTITION BY s.task_id, s.user_id ORDER BY s.points_private DESC, s.id ASC) AS rn
         FROM submissions s
         WHERE s.status='scored' AND s.points_private IS NOT NULL
           AND s.task_id IN (${placeholders})
       ),
       sb AS (SELECT * FROM selected_best WHERE rn = 1),
       ob AS (SELECT * FROM overall_best WHERE rn = 1)
       SELECT
         COALESCE(sb.task_id, ob.task_id) AS taskId,
         COALESCE(sb.user_id, ob.user_id) AS userId,
         COALESCE(sb.points, ob.points) AS points,
         COALESCE(sb.raw_score, ob.raw_score) AS rawScore,
         COALESCE(sb.created_at, ob.created_at) AS createdAt,
         u.display_name AS nickname,
         u.kaggle_id AS kaggleId
       FROM sb FULL OUTER JOIN ob
         ON sb.task_id = ob.task_id AND sb.user_id = ob.user_id
       JOIN users u ON u.id = COALESCE(sb.user_id, ob.user_id)
       ORDER BY COALESCE(sb.points, ob.points) DESC, u.id ASC`
    ).all(...taskIds, ...taskIds);
  } else {
    const pointsCol = 'points_public';
    const rawCol = 'raw_score_public';
    rows = db.prepare(
      `WITH best AS (
         SELECT s.task_id, s.user_id, s.${pointsCol} AS points, s.${rawCol} AS raw_score, s.created_at,
                ROW_NUMBER() OVER (PARTITION BY s.task_id, s.user_id ORDER BY s.${pointsCol} DESC, s.id ASC) AS rn
         FROM submissions s
         WHERE s.status = 'scored' AND s.${pointsCol} IS NOT NULL AND s.task_id IN (${placeholders})
       )
       SELECT b.task_id AS taskId, b.user_id AS userId, b.points, b.raw_score AS rawScore, b.created_at AS createdAt,
              u.display_name AS nickname, u.kaggle_id AS kaggleId
       FROM best b
       JOIN users u ON u.id = b.user_id
       WHERE b.rn = 1
       ORDER BY b.points DESC, u.id ASC`
    ).all(...taskIds);
  }

  const byUser = new Map();
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const r of rows) {
    if (!byUser.has(r.userId)) {
      byUser.set(r.userId, {
        participantKey: `user:${r.userId}`,
        nickname: r.nickname,
        teamName: r.nickname,
        totalPoints: 0,
        previousTotalPoints: null,
        tasks: {},
      });
    }
    const e = byUser.get(r.userId);
    const slug = taskById.get(r.taskId).slug;
    e.tasks[slug] = {
      points: r.points,
      previousPoints: null,
      rawScore: r.rawScore,
      rank: null,
    };
    e.totalPoints += r.points;
  }

  const overall = [...byUser.values()]
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((e, idx) => {
      const userId = userIdFromKey(e.participantKey);
      const bonus = userId != null ? (bonusByUserId.get(userId) || 0) : 0;
      return { ...e, place: idx + 1, bonusPoints: bonus };
    });

  const byTask = {};
  for (const t of tasks) {
    const taskRows = rows.filter((r) => r.taskId === t.id).sort((a, b) => b.points - a.points);
    byTask[t.slug] = {
      slug: t.slug,
      title: t.title,
      higherIsBetter: t.higherIsBetter,
      updatedAt: null,
      entries: taskRows.map((r, idx) => ({
        place: idx + 1,
        participantKey: `user:${r.userId}`,
        nickname: r.nickname,
        teamName: r.nickname,
        rank: idx + 1,
        score: r.rawScore,
        points: r.points,
        previousPoints: null,
      })),
    };
  }

  return { tasks, overall, byTask };
}

function userIdFromKey(key) {
  if (typeof key !== 'string') return null;
  const m = key.match(/^user:(\d+)$/);
  return m ? Number(m[1]) : null;
}

function emptyResponse(tasks) {
  const byTask = {};
  for (const t of tasks) {
    byTask[t.slug] = { slug: t.slug, title: t.title, higherIsBetter: t.higherIsBetter, updatedAt: null, entries: [] };
  }
  return { tasks, overall: [], byTask };
}
