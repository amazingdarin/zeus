BEGIN;

CREATE TABLE IF NOT EXISTS plugin_user_installation
(
    user_id      TEXT NOT NULL,
    plugin_id    TEXT NOT NULL,
    version      TEXT NOT NULL,
    enabled      BOOLEAN NOT NULL DEFAULT true,
    status       TEXT NOT NULL DEFAULT 'installed',
    installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error   TEXT,
    PRIMARY KEY (user_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_installation_user_status_updated
ON plugin_user_installation (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_installation_plugin_version
ON plugin_user_installation (plugin_id, version);

CREATE TABLE IF NOT EXISTS plugin_user_settings
(
    user_id       TEXT NOT NULL,
    plugin_id     TEXT NOT NULL,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, plugin_id)
);

CREATE TABLE IF NOT EXISTS plugin_audit_log
(
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT NOT NULL,
    plugin_id     TEXT NOT NULL,
    operation_id  TEXT NOT NULL,
    project_scope TEXT NOT NULL,
    status        TEXT NOT NULL,
    duration_ms   INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_user_created
ON plugin_audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_plugin_created
ON plugin_audit_log (plugin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_project_created
ON plugin_audit_log (project_scope, created_at DESC);

COMMIT;
