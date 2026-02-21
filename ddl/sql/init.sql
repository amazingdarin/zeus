CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS zhparser;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'zhparser') THEN
    CREATE TEXT SEARCH CONFIGURATION zhparser (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION zhparser ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END
$$;

CREATE TABLE project
(
    id            TEXT PRIMARY KEY,
    key           TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    repo_url      TEXT NOT NULL,
    repo_base_url TEXT NOT NULL,
    repo_name     TEXT NOT NULL,
    owner_type    TEXT NOT NULL DEFAULT 'user',
    owner_id      TEXT NOT NULL,
    visibility    TEXT NOT NULL DEFAULT 'private',
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (key, owner_type, owner_id)
);

CREATE TABLE IF NOT EXISTS "user"
(
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    email             TEXT NOT NULL UNIQUE,
    username          TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    display_name      TEXT,
    avatar_url        TEXT,
    status            TEXT NOT NULL DEFAULT 'active',
    email_verified_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_email ON "user" (email);
CREATE INDEX IF NOT EXISTS idx_user_username ON "user" (username);
CREATE INDEX IF NOT EXISTS idx_user_status ON "user" (status);

CREATE TABLE IF NOT EXISTS team
(
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    avatar_url  TEXT,
    owner_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_slug ON team (slug);
CREATE INDEX IF NOT EXISTS idx_team_owner ON team (owner_id);
CREATE INDEX IF NOT EXISTS idx_team_status ON team (status);

CREATE TABLE IF NOT EXISTS team_member
(
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member',
    joined_at  TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_member_team ON team_member (team_id);
CREATE INDEX IF NOT EXISTS idx_team_member_user ON team_member (user_id);
CREATE INDEX IF NOT EXISTS idx_team_member_role ON team_member (role);

CREATE TABLE IF NOT EXISTS session
(
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    device_info TEXT,
    ip_address  INET,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_user ON session (user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON session (token_hash);
CREATE INDEX IF NOT EXISTS idx_session_expires ON session (expires_at);

CREATE TABLE IF NOT EXISTS team_invitation
(
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'member',
    invited_by TEXT NOT NULL REFERENCES "user"(id),
    status     TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_team ON team_invitation (team_id);
CREATE INDEX IF NOT EXISTS idx_invitation_email ON team_invitation (email);
CREATE INDEX IF NOT EXISTS idx_invitation_status ON team_invitation (status);

CREATE TABLE IF NOT EXISTS team_join_link
(
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id      TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    role         TEXT NOT NULL DEFAULT 'member',
    created_by   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_join_link_team_role_exp
ON team_join_link (team_id, role, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_join_link_team_revoked
ON team_join_link (team_id, revoked_at);

CREATE TABLE storage_object
(
    id                     TEXT PRIMARY KEY,
    project_id             TEXT NOT NULL DEFAULT '',
    -- source info
    source_type            TEXT NOT NULL,
    source_upload_batch_id TEXT,
    source_url             TEXT,
    source_imported_from   TEXT,
    -- storage info
    storage_type           TEXT NOT NULL,
    s3_bucket              TEXT,
    s3_key                 TEXT,
    local_base_path        TEXT,
    local_file_path        TEXT,
    -- file metadata
    size_bytes             BIGINT,
    mime_type              TEXT,
    checksum               TEXT,
    created_at             TIMESTAMPTZ   DEFAULT now(),
    updated_at             TIMESTAMPTZ   DEFAULT now()
);

CREATE TABLE task (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  payload         JSONB,
  status          TEXT NOT NULL,
  attempts        INT  NOT NULL DEFAULT 0,
  max_attempts    INT  NOT NULL DEFAULT 3,
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  last_heartbeat  TIMESTAMPTZ,
  lock_owner      TEXT,
  lock_expires_at TIMESTAMPTZ,
  result          JSONB,
  error_message   TEXT,
  callback_url    TEXT,
  callback_secret TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE message_center_tasks (
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

CREATE TABLE knowledge_fulltext_index
(
    owner_type   TEXT NOT NULL DEFAULT 'personal',
    owner_id     TEXT NOT NULL DEFAULT '',
    project_key  TEXT NOT NULL,
    index_name   TEXT NOT NULL,
    doc_id       TEXT NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    content_plain TEXT NOT NULL DEFAULT '',
    tsv_en       tsvector NOT NULL,
    tsv_zh       tsvector NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (owner_type, owner_id, project_key, index_name, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_kft_en
ON knowledge_fulltext_index USING GIN(tsv_en);

CREATE INDEX IF NOT EXISTS idx_kft_zh
ON knowledge_fulltext_index USING GIN(tsv_zh);

CREATE INDEX IF NOT EXISTS idx_kft_owner_project
ON knowledge_fulltext_index (owner_type, owner_id, project_key);

CREATE TABLE knowledge_embedding_index
(
    owner_type   TEXT NOT NULL DEFAULT 'personal',
    owner_id     TEXT NOT NULL DEFAULT '',
    project_key  TEXT NOT NULL,
    index_name   TEXT NOT NULL,
    doc_id       TEXT NOT NULL,
    block_id     TEXT NOT NULL,
    chunk_index  INT  NOT NULL,
    content      TEXT NOT NULL,
    model        TEXT NOT NULL,
    embedding    vector(1536) NOT NULL,  -- Support OpenAI text-embedding-3-small (1536 dim)
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_type, owner_id, project_key, index_name, doc_id, block_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kei_owner_project
ON knowledge_embedding_index (owner_type, owner_id, project_key);

CREATE INDEX IF NOT EXISTS idx_kei_embedding
ON knowledge_embedding_index USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS knowledge_index (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    owner_type  TEXT NOT NULL DEFAULT 'personal',
    owner_id    TEXT NOT NULL DEFAULT '',
    project_key TEXT NOT NULL,
    doc_id      TEXT NOT NULL,
    granularity TEXT NOT NULL CHECK (granularity IN ('document', 'section', 'block', 'code')),
    content     TEXT NOT NULL,
    embedding   vector(1536),
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    tsv_en      tsvector GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(metadata->>'title', '') || ' ' || content)
                ) STORED,
    tsv_zh      tsvector,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ki_user_owner_project
ON knowledge_index (user_id, owner_type, owner_id, project_key);

CREATE INDEX IF NOT EXISTS idx_ki_doc
ON knowledge_index (doc_id);

CREATE INDEX IF NOT EXISTS idx_ki_granularity
ON knowledge_index (granularity);

CREATE INDEX IF NOT EXISTS idx_ki_embedding
ON knowledge_index USING ivfflat (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_ki_tsv_en
ON knowledge_index USING GIN (tsv_en);

CREATE INDEX IF NOT EXISTS idx_ki_tsv_zh
ON knowledge_index USING GIN (tsv_zh);

CREATE INDEX IF NOT EXISTS idx_ki_metadata
ON knowledge_index USING GIN (metadata jsonb_path_ops);

CREATE OR REPLACE FUNCTION update_knowledge_index_tsv_zh()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv_zh := to_tsvector('zhparser',
        coalesce(NEW.metadata->>'title', '') || ' ' || NEW.content
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_index_tsv_zh ON knowledge_index;
CREATE TRIGGER trg_knowledge_index_tsv_zh
    BEFORE INSERT OR UPDATE OF content, metadata
    ON knowledge_index
    FOR EACH ROW
    EXECUTE FUNCTION update_knowledge_index_tsv_zh();

CREATE TABLE IF NOT EXISTS raptor_tree (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    owner_type  TEXT NOT NULL DEFAULT 'personal',
    owner_id    TEXT NOT NULL DEFAULT '',
    project_key TEXT NOT NULL,
    doc_id      TEXT NOT NULL,
    level       INTEGER NOT NULL,
    parent_id   TEXT,
    children    TEXT[] DEFAULT '{}'::text[],
    content     TEXT NOT NULL,
    embedding   vector(1536),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raptor_user_owner_project
ON raptor_tree (user_id, owner_type, owner_id, project_key);

CREATE INDEX IF NOT EXISTS idx_raptor_doc
ON raptor_tree (doc_id);

CREATE INDEX IF NOT EXISTS idx_raptor_level
ON raptor_tree (level);

CREATE INDEX IF NOT EXISTS idx_raptor_parent
ON raptor_tree (parent_id);

CREATE INDEX IF NOT EXISTS idx_raptor_embedding
ON raptor_tree USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS document_summary_cache (
    doc_id      TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    owner_type  TEXT NOT NULL DEFAULT 'personal',
    owner_id    TEXT NOT NULL DEFAULT '',
    project_key TEXT NOT NULL,
    summary     TEXT NOT NULL,
    model       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ,
    PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_summary_user_owner_project
ON document_summary_cache (user_id, owner_type, owner_id, project_key);

-- Custom PPT templates (project-scoped, owner-scoped)
CREATE TABLE IF NOT EXISTS ppt_templates
(
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type      TEXT NOT NULL DEFAULT 'personal',
    owner_id        TEXT NOT NULL DEFAULT '',
    project_key     VARCHAR(255) NOT NULL,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    preview_url     TEXT,
    template_images TEXT[] DEFAULT '{}'::text[],
    color_primary   VARCHAR(7),
    color_secondary VARCHAR(7),
    color_background VARCHAR(7),
    color_text      VARCHAR(7),
    color_accent    VARCHAR(7),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ppt_templates_owner_project_name
ON ppt_templates (owner_type, owner_id, project_key, name);

CREATE INDEX IF NOT EXISTS idx_ppt_owner_project
ON ppt_templates (owner_type, owner_id, project_key);

-- LLM Provider Configuration
CREATE TABLE llm_provider_config
(
    id              TEXT PRIMARY KEY,
    config_type     TEXT NOT NULL DEFAULT 'llm', -- llm, embedding
    provider_id     TEXT NOT NULL,              -- openai, anthropic, google, ollama, openai-compatible
    display_name    TEXT NOT NULL,
    base_url        TEXT,
    default_model   TEXT,
    api_key_cipher  TEXT,                       -- AES-256-GCM encrypted
    api_key_iv      TEXT,                       -- initialization vector
    enabled         BOOLEAN DEFAULT true,
    status          TEXT DEFAULT 'unknown',     -- active, error, unknown
    last_error      TEXT,
    last_tested_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (config_type)                        -- only one config per type
);

CREATE INDEX IF NOT EXISTS idx_llm_provider_config_provider
ON llm_provider_config (provider_id);

CREATE INDEX IF NOT EXISTS idx_llm_provider_config_type
ON llm_provider_config (config_type);

-- Skill Configuration
CREATE TABLE skill_config
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

-- Default skill configurations
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

-- Project-scoped skill configuration for System Agent
CREATE TABLE IF NOT EXISTS project_skill_config
(
    id            TEXT PRIMARY KEY,
    owner_type    TEXT NOT NULL DEFAULT 'personal',
    owner_id      TEXT NOT NULL DEFAULT '',
    project_key   TEXT NOT NULL,
    skill_id      TEXT NOT NULL,
    source        TEXT NOT NULL, -- native | anthropic | mcp
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

-- Web Search Configuration
CREATE TABLE web_search_config
(
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        TEXT NOT NULL,              -- tavily, serpapi, duckduckgo
    api_key_cipher  TEXT,                       -- AES-256-GCM encrypted
    api_key_iv      TEXT,                       -- initialization vector
    enabled         BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Only allow one web search config (singleton pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_web_search_config_singleton
ON web_search_config ((true));

-- Chat Settings (singleton)
CREATE TABLE chat_settings
(
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    full_access   BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_settings_singleton
ON chat_settings ((true));

-- Seed default row
INSERT INTO chat_settings (full_access) VALUES (false) ON CONFLICT DO NOTHING;

-- Chat Sessions
CREATE TABLE chat_sessions
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

-- Chat Messages
CREATE TABLE chat_messages
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

-- Document Favorites (user-scoped, project-scoped)
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

-- Document Recent Edits (user-scoped, project-scoped)
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

-- User-level plugin installation state
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
    manifest_api_version INTEGER NOT NULL DEFAULT 2,
    capabilities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    activation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (user_id, plugin_id)
);

CREATE INDEX IF NOT EXISTS idx_plugin_installation_user_status_updated
ON plugin_user_installation (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_installation_plugin_version
ON plugin_user_installation (plugin_id, version);

-- Per-user plugin settings
CREATE TABLE IF NOT EXISTS plugin_user_settings
(
    user_id       TEXT NOT NULL,
    plugin_id     TEXT NOT NULL,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, plugin_id)
);

-- Plugin execution audit logs
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
    event_type    TEXT NOT NULL DEFAULT 'operation',
    hook_stage    TEXT,
    decision      TEXT,
    request_id    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_user_created
ON plugin_audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_plugin_created
ON plugin_audit_log (plugin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_project_created
ON plugin_audit_log (project_scope, created_at DESC);

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
