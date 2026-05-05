-- ───────────────────────────────────────────────────────────
-- Native tasks: добавляем второй ground-truth (private, опционально).
-- Существующий ground_truth_path по конвенции становится "public" GT.
ALTER TABLE native_tasks ADD COLUMN ground_truth_private_path TEXT;

-- ───────────────────────────────────────────────────────────
-- Submissions: храним по два значения (public + private), оба опциональные
CREATE TABLE submissions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER NOT NULL REFERENCES native_tasks(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  sha256            TEXT NOT NULL,
  path              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'scoring', 'scored', 'failed')),
  raw_score_public   REAL,
  raw_score_private  REAL,
  points_public      REAL,
  points_private     REAL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  log_excerpt       TEXT,
  duration_ms       INTEGER,
  started_at        TEXT,
  scored_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Worker pickNext + stale-recovery
CREATE INDEX submissions_active
  ON submissions (id)
  WHERE status IN ('pending', 'scoring');

-- Лидерборд per-user-best (public + private отдельно)
CREATE INDEX submissions_task_user_score_public
  ON submissions (task_id, user_id, points_public DESC, id)
  WHERE status = 'scored' AND points_public IS NOT NULL;

CREATE INDEX submissions_task_user_score_private
  ON submissions (task_id, user_id, points_private DESC, id)
  WHERE status = 'scored' AND points_private IS NOT NULL;

-- «Мои сабмиты»
CREATE INDEX submissions_user_recent
  ON submissions (user_id, task_id, created_at DESC);

-- Rate-limit count за последние 24ч
CREATE INDEX submissions_user_task_time
  ON submissions (user_id, task_id, created_at);
