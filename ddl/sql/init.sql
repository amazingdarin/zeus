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
    embedding     vector(768) NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_key, index_name, doc_id, block_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kei_project
ON knowledge_embedding_index (project_key);

CREATE INDEX IF NOT EXISTS idx_kei_embedding
ON knowledge_embedding_index USING ivfflat (embedding vector_l2_ops);

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
