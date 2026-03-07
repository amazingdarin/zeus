BEGIN;

CREATE TABLE IF NOT EXISTS llm_provider_config
(
    id              TEXT PRIMARY KEY,
    config_type     TEXT NOT NULL DEFAULT 'llm',
    provider_id     TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    base_url        TEXT,
    default_model   TEXT,
    api_key_cipher  TEXT,
    api_key_iv      TEXT,
    enabled         BOOLEAN DEFAULT true,
    status          TEXT DEFAULT 'unknown',
    last_error      TEXT,
    last_tested_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (config_type)
);

CREATE INDEX IF NOT EXISTS idx_llm_provider_config_provider
ON llm_provider_config (provider_id);

CREATE INDEX IF NOT EXISTS idx_llm_provider_config_type
ON llm_provider_config (config_type);

CREATE TABLE IF NOT EXISTS skill_config
(
    id          TEXT PRIMARY KEY,
    skill_name  TEXT NOT NULL UNIQUE,
    category    TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    priority    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_config_category
ON skill_config (category);

CREATE INDEX IF NOT EXISTS idx_skill_config_enabled
ON skill_config (enabled);

INSERT INTO skill_config (id, skill_name, category, enabled, priority) VALUES
    (gen_random_uuid(), 'doc-read', 'doc', true, 10),
    (gen_random_uuid(), 'doc-create', 'doc', true, 20),
    (gen_random_uuid(), 'doc-edit', 'doc', true, 30),
    (gen_random_uuid(), 'doc-optimize-format', 'doc', true, 40),
    (gen_random_uuid(), 'doc-optimize-content', 'doc', true, 50),
    (gen_random_uuid(), 'doc-summary', 'doc', true, 60),
    (gen_random_uuid(), 'doc-move', 'doc', true, 70),
    (gen_random_uuid(), 'doc-delete', 'doc', true, 80),
    (gen_random_uuid(), 'kb-search', 'kb', true, 90),
    (gen_random_uuid(), 'doc-fetch-url', 'doc', true, 100),
    (gen_random_uuid(), 'doc-import-git', 'doc', true, 110),
    (gen_random_uuid(), 'doc-convert', 'doc', true, 120)
ON CONFLICT (skill_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS project_skill_config
(
    id            TEXT PRIMARY KEY,
    owner_type    TEXT NOT NULL DEFAULT 'personal',
    owner_id      TEXT NOT NULL DEFAULT '',
    project_key   TEXT NOT NULL,
    skill_id      TEXT NOT NULL,
    source        TEXT NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    priority      INTEGER NOT NULL DEFAULT 0,
    risk_override TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (owner_type, owner_id, project_key, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_project_skill_config_owner_project
ON project_skill_config (owner_type, owner_id, project_key);

CREATE INDEX IF NOT EXISTS idx_project_skill_config_source
ON project_skill_config (source);

CREATE INDEX IF NOT EXISTS idx_project_skill_config_enabled
ON project_skill_config (enabled);

CREATE TABLE IF NOT EXISTS web_search_config
(
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        TEXT NOT NULL,
    api_key_cipher  TEXT,
    api_key_iv      TEXT,
    enabled         BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_search_config_singleton
ON web_search_config ((true));

CREATE TABLE IF NOT EXISTS chat_settings
(
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    full_access   BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_settings_singleton
ON chat_settings ((true));

INSERT INTO chat_settings (full_access) VALUES (false) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS chat_sessions
(
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT NOT NULL,
    owner_type    TEXT NOT NULL DEFAULT 'personal',
    owner_id      TEXT NOT NULL DEFAULT '',
    project_key   TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '新对话',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_user_project
ON chat_sessions (owner_type, owner_id, user_id, project_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages
(
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    sources       JSONB,
    artifacts     JSONB,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
ON chat_messages (session_id, created_at);

CREATE TABLE IF NOT EXISTS document_favorites
(
    user_id      TEXT NOT NULL,
    owner_type   TEXT NOT NULL DEFAULT 'personal',
    owner_id     TEXT NOT NULL DEFAULT '',
    project_key  TEXT NOT NULL,
    doc_id       TEXT NOT NULL,
    favorited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_document_favorites_user_owner_project_order
ON document_favorites (user_id, owner_type, owner_id, project_key, favorited_at DESC);

CREATE TABLE IF NOT EXISTS document_recent_edits
(
    user_id     TEXT NOT NULL,
    owner_type  TEXT NOT NULL DEFAULT 'personal',
    owner_id    TEXT NOT NULL DEFAULT '',
    project_key TEXT NOT NULL,
    doc_id      TEXT NOT NULL,
    edited_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_document_recent_edits_user_owner_project_order
ON document_recent_edits (user_id, owner_type, owner_id, project_key, edited_at DESC);

COMMIT;
