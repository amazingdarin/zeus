CREATE TABLE raw_document (
  id            BIGSERIAL PRIMARY KEY,
  doc_id        TEXT UNIQUE NOT NULL,
  source_type   TEXT,              -- pdf / word / confluence / markdown
  source_uri    TEXT,              -- S3 / URL
  title         TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE spec_version (
  id            BIGSERIAL PRIMARY KEY,
  system_id     TEXT NOT NULL,
  version       TEXT NOT NULL,      -- v1.1.0
  is_current    BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now(),
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