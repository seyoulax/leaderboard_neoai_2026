PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ───────────────────────────────────────────────────────────
-- Competitions: replaces data/competitions.json
CREATE TABLE competitions (
  slug          TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  subtitle      TEXT,
  type          TEXT NOT NULL CHECK (type IN ('kaggle', 'native')),
  visible       INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at    TEXT
);
CREATE INDEX competitions_visible_order
  ON competitions (visible, display_order)
  WHERE deleted_at IS NULL;

-- ───────────────────────────────────────────────────────────
-- Users
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  kaggle_id     TEXT,
  role          TEXT NOT NULL DEFAULT 'participant'
                  CHECK (role IN ('participant', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX users_email_unique ON users (email COLLATE NOCASE);
CREATE UNIQUE INDEX users_kaggle_unique ON users (kaggle_id) WHERE kaggle_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────
-- Sessions: cookie session id → user
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- ───────────────────────────────────────────────────────────
-- Competition members: join users ↔ competitions (наполняется в SP-3)
CREATE TABLE competition_members (
  competition_slug TEXT NOT NULL REFERENCES competitions(slug) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (competition_slug, user_id)
);
CREATE INDEX competition_members_user ON competition_members (user_id);
