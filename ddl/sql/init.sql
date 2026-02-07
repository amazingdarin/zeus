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
    id          TEXT PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    repo_url    TEXT NOT NULL,
    repo_base_url TEXT NOT NULL,
    repo_name   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

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

CREATE TABLE knowledge_fulltext_index
(
    project_key   TEXT NOT NULL,
    index_name    TEXT NOT NULL,
    doc_id        TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '',
    content_plain TEXT NOT NULL DEFAULT '',
    tsv_en        tsvector NOT NULL,
    tsv_zh        tsvector NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (project_key, index_name, doc_id)
);

CREATE INDEX IF NOT EXISTS idx_kft_en
ON knowledge_fulltext_index USING GIN(tsv_en);

CREATE INDEX IF NOT EXISTS idx_kft_zh
ON knowledge_fulltext_index USING GIN(tsv_zh);

CREATE TABLE knowledge_embedding_index
(
    project_key   TEXT NOT NULL,
    index_name    TEXT NOT NULL,
    doc_id        TEXT NOT NULL,
    block_id      TEXT NOT NULL,
    chunk_index   INT  NOT NULL,
    content       TEXT NOT NULL,
    model         TEXT NOT NULL,
    embedding     vector(1536) NOT NULL,  -- Support OpenAI text-embedding-3-small (1536 dim)
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_key, index_name, doc_id, block_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kei_project
ON knowledge_embedding_index (project_key);

CREATE INDEX IF NOT EXISTS idx_kei_embedding
ON knowledge_embedding_index USING ivfflat (embedding vector_cosine_ops);

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
    project_key   TEXT NOT NULL,
    skill_id      TEXT NOT NULL,
    source        TEXT NOT NULL, -- native | anthropic | mcp
    enabled       BOOLEAN NOT NULL DEFAULT true,
    priority      INTEGER NOT NULL DEFAULT 0,
    risk_override TEXT,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (project_key, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_project_skill_config_project
ON project_skill_config (project_key);

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
    project_key   TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '新对话',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_project
ON chat_sessions (project_key, updated_at DESC);

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
