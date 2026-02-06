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

-- ============================================================
-- Multi-granularity knowledge index (knowledge_index)
-- ============================================================
-- NOTE: Vector dimension is set to 1536 to match the existing default embedding
-- model fallback in the app (`text-embedding-3-small`).

CREATE TABLE IF NOT EXISTS knowledge_index (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_ki_user_project
ON knowledge_index (user_id, project_key);

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

-- ============================================================
-- RAPTOR tree (raptor_tree)
-- ============================================================

CREATE TABLE IF NOT EXISTS raptor_tree (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    project_key TEXT NOT NULL,
    doc_id      TEXT NOT NULL,

    level       INTEGER NOT NULL,
    parent_id   TEXT,
    children    TEXT[] DEFAULT '{}'::text[],

    content     TEXT NOT NULL,
    embedding   vector(1536),

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raptor_user_project
ON raptor_tree (user_id, project_key);

CREATE INDEX IF NOT EXISTS idx_raptor_doc
ON raptor_tree (doc_id);

CREATE INDEX IF NOT EXISTS idx_raptor_level
ON raptor_tree (level);

CREATE INDEX IF NOT EXISTS idx_raptor_parent
ON raptor_tree (parent_id);

CREATE INDEX IF NOT EXISTS idx_raptor_embedding
ON raptor_tree USING ivfflat (embedding vector_cosine_ops);

-- ============================================================
-- Document summary cache (document_summary_cache)
-- ============================================================

CREATE TABLE IF NOT EXISTS document_summary_cache (
    doc_id      TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    project_key TEXT NOT NULL,
    summary     TEXT NOT NULL,
    model       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_doc_summary_user_project
ON document_summary_cache (user_id, project_key);
