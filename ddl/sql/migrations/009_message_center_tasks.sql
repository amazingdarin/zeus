BEGIN;

CREATE TABLE IF NOT EXISTS message_center_tasks (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  owner_type       TEXT NOT NULL DEFAULT 'personal',
  owner_id         TEXT NOT NULL DEFAULT '',
  project_key      TEXT NOT NULL,
  type             TEXT NOT NULL,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL,
  progress_current INT NOT NULL DEFAULT 0,
  progress_total   INT NOT NULL DEFAULT 0,
  progress_percent INT NOT NULL DEFAULT 0,
  detail_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_message_center_tasks_scope_status_updated
  ON message_center_tasks (user_id, owner_type, owner_id, project_key, status, updated_at DESC);

COMMIT;
