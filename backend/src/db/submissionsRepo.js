const COLS = `id,
  task_id AS taskId,
  user_id AS userId,
  original_filename AS originalFilename,
  size_bytes AS sizeBytes,
  sha256,
  path,
  status,
  raw_score_public AS rawScorePublic,
  raw_score_private AS rawScorePrivate,
  points_public AS pointsPublic,
  points_private AS pointsPrivate,
  attempts,
  error_message AS errorMessage,
  log_excerpt AS logExcerpt,
  duration_ms AS durationMs,
  started_at AS startedAt,
  scored_at AS scoredAt,
  created_at AS createdAt`;

export function insertSubmission(db, s) {
  const result = db
    .prepare(
      `INSERT INTO submissions (task_id, user_id, original_filename, size_bytes, sha256, path)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(s.taskId, s.userId, s.originalFilename, s.sizeBytes, s.sha256, s.path);
  return getSubmission(db, result.lastInsertRowid);
}

export function getSubmission(db, id) {
  return db.prepare(`SELECT ${COLS} FROM submissions WHERE id = ?`).get(id) || null;
}

export function listSubmissionsForUserTask(db, { userId, taskId }) {
  return db
    .prepare(
      `SELECT ${COLS} FROM submissions
       WHERE user_id = ? AND task_id = ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(userId, taskId);
}

export function listSubmissionsForTask(db, { taskId, status = null }) {
  if (status) {
    return db
      .prepare(`SELECT ${COLS} FROM submissions WHERE task_id = ? AND status = ? ORDER BY created_at DESC, id DESC`)
      .all(taskId, status);
  }
  return db
    .prepare(`SELECT ${COLS} FROM submissions WHERE task_id = ? ORDER BY created_at DESC, id DESC`)
    .all(taskId);
}

export function countRecentSubmissions(db, { userId, taskId, hours }) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM submissions
       WHERE user_id = ? AND task_id = ?
         AND created_at > datetime('now', ?)`
    )
    .get(userId, taskId, `-${hours} hours`).n;
}

export function pickAndMarkScoring(db) {
  return db.transaction(() => {
    const sub = db
      .prepare(
        `SELECT ${COLS} FROM submissions
         WHERE status = 'pending'
         ORDER BY id ASC
         LIMIT 1`
      )
      .get();
    if (!sub) return null;
    const result = db
      .prepare(
        `UPDATE submissions
         SET status = 'scoring', started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND status = 'pending'`
      )
      .run(sub.id);
    if (result.changes !== 1) return null;
    return getSubmission(db, sub.id);
  })();
}

export function markScored(db, id, { rawScorePublic, rawScorePrivate = null, pointsPublic, pointsPrivate = null, log, durationMs }) {
  db.prepare(
    `UPDATE submissions
     SET status = 'scored',
         raw_score_public = ?, raw_score_private = ?,
         points_public = ?, points_private = ?,
         log_excerpt = ?, duration_ms = ?,
         scored_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(rawScorePublic, rawScorePrivate, pointsPublic, pointsPrivate, log || '', durationMs, id);
}

export function markFailed(db, id, { error, log, durationMs }) {
  db.prepare(
    `UPDATE submissions
     SET status = 'failed',
         error_message = ?, log_excerpt = ?, duration_ms = ?,
         scored_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(String(error), log || '', durationMs, id);
}

export function markFailedRetry(db, id, { error, log, durationMs }) {
  db.prepare(
    `UPDATE submissions
     SET status = 'pending',
         attempts = attempts + 1,
         error_message = ?, log_excerpt = ?, duration_ms = ?,
         started_at = NULL
     WHERE id = ?`
  ).run(String(error), log || '', durationMs, id);
}

export function recoverStale(db, { staleThresholdMinutes = 15 } = {}) {
  return db.prepare(
    `UPDATE submissions
     SET status = 'pending', attempts = attempts + 1, started_at = NULL,
         error_message = 'recovered from stale scoring'
     WHERE status = 'scoring' AND started_at < datetime('now', ?)`
  ).run(`-${staleThresholdMinutes} minutes`).changes;
}

export function resetSubmissionForRescore(db, id) {
  db.prepare(
    `UPDATE submissions
     SET status = 'pending',
         raw_score_public = NULL, raw_score_private = NULL,
         points_public = NULL, points_private = NULL,
         attempts = 0, error_message = NULL, log_excerpt = NULL,
         duration_ms = NULL, started_at = NULL, scored_at = NULL
     WHERE id = ?`
  ).run(id);
}

export function resetAllForRescore(db, taskId) {
  return db.prepare(
    `UPDATE submissions
     SET status = 'pending',
         raw_score_public = NULL, raw_score_private = NULL,
         points_public = NULL, points_private = NULL,
         attempts = 0, error_message = NULL, log_excerpt = NULL,
         duration_ms = NULL, started_at = NULL, scored_at = NULL
     WHERE task_id = ? AND status IN ('scored', 'failed')`
  ).run(taskId).changes;
}

export function deleteSubmission(db, id) {
  db.prepare('DELETE FROM submissions WHERE id = ?').run(id);
}
