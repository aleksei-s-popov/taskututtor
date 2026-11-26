-- Taskututtor account-mode storage (Cloudflare D1 / SQLite). Safe to re-run.

-- Reader profile: level, preferences and word knowledge, as one JSON document.
CREATE TABLE IF NOT EXISTS profiles (
  user_id    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Series metadata (title, premise, canon, hidden plot plan, art bible) as JSON.
CREATE TABLE IF NOT EXISTS series (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  data       TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS series_user ON series (user_id, updated_at);

-- One row per chapter: generated content plus the reader's progress, as JSON.
CREATE TABLE IF NOT EXISTS chapters (
  id         TEXT PRIMARY KEY,
  series_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  idx        INTEGER NOT NULL,
  data       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chapters_user ON chapters (user_id, updated_at);
CREATE INDEX IF NOT EXISTS chapters_series ON chapters (series_id, idx);

-- Background chapter-writing jobs.
CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  input      TEXT NOT NULL,
  status     TEXT NOT NULL,          -- queued | running | done | error
  error      TEXT,
  series_id  TEXT,
  chapter_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs (user_id, created_at);

-- Problems reported by readers from inside the app (wrong Finnish, inappropriate content, bugs).
CREATE TABLE IF NOT EXISTS reports (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  category   TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  chapter_id TEXT,
  screen     TEXT,
  status     TEXT NOT NULL DEFAULT 'new',   -- new | done
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_status ON reports (status, created_at);
