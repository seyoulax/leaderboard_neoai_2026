-- ───────────────────────────────────────────────────────────
-- Visibility: расширение существующих competitions
ALTER TABLE competitions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'unlisted'));

UPDATE competitions SET visibility = CASE
  WHEN visible = 1 THEN 'public'
  ELSE 'unlisted'
END;

-- Старая колонка `visible` остаётся read-only до SP-4 cleanup'а: фронт перестаёт
-- её писать, бэк перестаёт её читать в новых code paths. Дроп — в SP-4.

CREATE INDEX competitions_listed
  ON competitions (display_order, slug)
  WHERE deleted_at IS NULL AND visibility = 'public';

-- ───────────────────────────────────────────────────────────
-- Native tasks: одна задача внутри native-соревнования
CREATE TABLE native_tasks (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_slug         TEXT NOT NULL REFERENCES competitions(slug) ON DELETE CASCADE,
  slug                     TEXT NOT NULL,
  title                    TEXT NOT NULL,
  description_md           TEXT NOT NULL DEFAULT '',
  higher_is_better         INTEGER NOT NULL DEFAULT 1 CHECK (higher_is_better IN (0, 1)),
  baseline_score_public    REAL,
  author_score_public      REAL,
  baseline_score_private   REAL,
  author_score_private     REAL,
  grader_path              TEXT,
  ground_truth_path        TEXT,
  visible                  INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  display_order            INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at               TEXT,
  UNIQUE (competition_slug, slug)
);
CREATE INDEX native_tasks_active
  ON native_tasks (competition_slug, display_order, slug)
  WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────
-- Files: датасеты + стартовые артефакты в одной таблице
CREATE TABLE native_task_files (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER NOT NULL REFERENCES native_tasks(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN ('dataset', 'artifact')),
  display_name      TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  original_filename TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  sha256            TEXT NOT NULL,
  path              TEXT NOT NULL,
  display_order     INTEGER NOT NULL DEFAULT 0,
  uploaded_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX native_task_files_by_task ON native_task_files (task_id, kind, display_order);
