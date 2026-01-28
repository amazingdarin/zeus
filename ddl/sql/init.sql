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

CREATE TABLE model_runtime
(
    id          TEXT PRIMARY KEY,
    scenario    TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    base_url    TEXT    NOT NULL,
    api_key     TEXT,
    model_name  TEXT    NOT NULL,
    parameters  JSONB,
    provider_connection_id TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ       DEFAULT now(),
    updated_at  TIMESTAMPTZ       DEFAULT now()
);

CREATE TABLE provider_connection
(
    id            TEXT PRIMARY KEY,
    provider_id   TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    base_url      TEXT,
    model_name    TEXT,
    credential_id TEXT NOT NULL,
    status        TEXT NOT NULL,
    last_error    TEXT,
    last_used_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    created_by    TEXT,
    updated_by    TEXT
);

CREATE TABLE provider_credential
(
    id            TEXT PRIMARY KEY,
    provider_id   TEXT NOT NULL,
    scope_type    TEXT NOT NULL,
    scope_id      TEXT,
    type          TEXT NOT NULL,
    ciphertext    TEXT NOT NULL,
    nonce         TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,
    key_id        TEXT NOT NULL,
    key_version   INT  NOT NULL,
    expires_at    TIMESTAMPTZ,
    scopes        TEXT,
    metadata      JSONB,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    created_by    TEXT,
    updated_by    TEXT,
    last_used_at  TIMESTAMPTZ,
    last_used_by  TEXT
);

CREATE TABLE document
(
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL DEFAULT '',
    type              TEXT NOT NULL,
    title             TEXT,
    description       TEXT,
    status            TEXT NOT NULL,
    path              TEXT NOT NULL,
    "order"           INT  NOT NULL DEFAULT 0,
    parent_id         TEXT NOT NULL DEFAULT '',
    storage_object_id TEXT NOT NULL,
    created_at        TIMESTAMPTZ   DEFAULT now(),
    updated_at        TIMESTAMPTZ   DEFAULT now()
);

CREATE EXTENSION IF NOT EXISTS zhparser;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'zhparser') THEN
    CREATE TEXT SEARCH CONFIGURATION zhparser (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION zhparser ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END
$$;

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



CREATE TABLE spec_version
(
    id         BIGSERIAL PRIMARY KEY,
    system_id  TEXT NOT NULL,
    version    TEXT NOT NULL, -- v1.1.0
    is_current BOOLEAN     DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (system_id, version)
);


CREATE TABLE system_spec (
  id              BIGSERIAL PRIMARY KEY,
  system_id       TEXT NOT NULL,
  spec_version_id BIGINT REFERENCES spec_version(id),
  content         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (system_id, spec_version_id)
);

CREATE TABLE module_spec (
  id              BIGSERIAL PRIMARY KEY,
  module_id       TEXT NOT NULL,
  system_id       TEXT NOT NULL,
  spec_version_id BIGINT REFERENCES spec_version(id),
  content         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (module_id, spec_version_id)
);

CREATE TABLE page_spec (
  id              BIGSERIAL PRIMARY KEY,
  page_id         TEXT NOT NULL,
  module_id       TEXT NOT NULL,
  system_id       TEXT NOT NULL,
  spec_version_id BIGINT REFERENCES spec_version(id),
  content         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (page_id, spec_version_id)
);

CREATE TABLE api_spec (
  id              BIGSERIAL PRIMARY KEY,
  api_id          TEXT NOT NULL,
  module_id       TEXT NOT NULL,
  system_id       TEXT NOT NULL,
  spec_version_id BIGINT REFERENCES spec_version(id),
  method          TEXT,
  path            TEXT,
  content         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (api_id, spec_version_id)
);

CREATE TABLE data_spec (
  id              BIGSERIAL PRIMARY KEY,
  entity          TEXT NOT NULL,
  module_id       TEXT,
  system_id       TEXT NOT NULL,
  spec_version_id BIGINT REFERENCES spec_version(id),
  content         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (entity, spec_version_id)
);

CREATE TABLE requirement_spec (
  id              BIGSERIAL PRIMARY KEY,
  requirement_id  TEXT NOT NULL,
  system_id       TEXT NOT NULL,
  iteration       TEXT,
  type            TEXT,
  priority        TEXT,
  content         JSONB NOT NULL,
  merged_version  TEXT,     -- v1.1.0
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (requirement_id)
);

CREATE TABLE spec_relation (
  id          BIGSERIAL PRIMARY KEY,
  from_type   TEXT,   -- page / api / data / module / requirement
  from_id     TEXT,
  to_type     TEXT,
  to_id       TEXT,
  relation    TEXT,   -- owns / uses / depends / implements
  system_id   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE module_snapshot (
  id              BIGSERIAL PRIMARY KEY,
  module_id       TEXT NOT NULL,
  system_id       TEXT NOT NULL,
  spec_version_id BIGINT REFERENCES spec_version(id),
  snapshot        JSONB NOT NULL,
  quality_status  TEXT,      -- healthy / conflict / stale
  confidence      FLOAT,
  generated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (module_id, spec_version_id)
);

CREATE TABLE rag_chunk (
  id          BIGSERIAL PRIMARY KEY,
  chunk_id    TEXT UNIQUE,
  chunk_type  TEXT,     -- module_snapshot / page / api / data / raw
  ref_id      TEXT,     -- spec_id
  system_id   TEXT,
  content     TEXT,     -- 用于 embedding
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
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

CREATE TABLE rag_document_summary (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  doc_id         TEXT NOT NULL,
  summary_text   TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  model_runtime  TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (project_id, doc_id)
);

CREATE TABLE knowledge_change_proposal (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  doc_id     TEXT NOT NULL,
  status     TEXT NOT NULL,
  meta       JSONB,
  content    JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE rag_index_unit (
  unit_id      TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  doc_id       TEXT NOT NULL,
  path         TEXT[] NOT NULL,
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source       JSONB NOT NULL,
  embedding    vector(1536) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_rag_index_unit_project_doc ON rag_index_unit(project_id, doc_id);
CREATE INDEX idx_rag_index_unit_project ON rag_index_unit(project_id);
CREATE INDEX idx_rag_index_unit_embedding ON rag_index_unit USING ivfflat (embedding vector_l2_ops);

CREATE TABLE agent_run (
  id            BIGSERIAL PRIMARY KEY,
  agent_type    TEXT,      -- ui / code / test / ops
  system_id     TEXT,
  spec_version  TEXT,
  input         JSONB,
  output        JSONB,
  status        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
