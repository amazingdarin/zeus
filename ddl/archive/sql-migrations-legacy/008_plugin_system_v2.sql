BEGIN;

ALTER TABLE plugin_user_installation
  ADD COLUMN IF NOT EXISTS manifest_api_version INTEGER NOT NULL DEFAULT 2;

ALTER TABLE plugin_user_installation
  ADD COLUMN IF NOT EXISTS capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE plugin_user_installation
  ADD COLUMN IF NOT EXISTS activation_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE plugin_audit_log
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'operation';

ALTER TABLE plugin_audit_log
  ADD COLUMN IF NOT EXISTS hook_stage TEXT;

ALTER TABLE plugin_audit_log
  ADD COLUMN IF NOT EXISTS decision TEXT;

ALTER TABLE plugin_audit_log
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_plugin_audit_event_created
ON plugin_audit_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_request_id
ON plugin_audit_log (request_id);

CREATE TABLE IF NOT EXISTS plugin_user_registry_snapshot
(
    user_id       TEXT NOT NULL,
    plugin_id     TEXT NOT NULL,
    version       TEXT NOT NULL,
    commands_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    hooks_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    routes_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
    tools_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_registry_snapshot_user_updated
ON plugin_user_registry_snapshot (user_id, updated_at DESC);

COMMIT;
