-- Migration: Multi-Granularity Knowledge Index
-- Description: Creates a unified index table supporting document, section, block, and code granularities
-- Date: 2026-02-05
--
-- ============================================================
-- IMPORTANT: Vector Dimension Configuration
-- ============================================================
-- The embedding column dimension MUST match your embedding model:
--   - OpenAI text-embedding-3-small: 1536
--   - OpenAI text-embedding-3-large: 3072
--   - Ollama nomic-embed-text:       768
--   - Ollama mxbai-embed-large:      1024
--   - Cohere embed-multilingual-v3:  1024
--
-- Default: 768 (for Ollama nomic-embed-text)
-- To change: ALTER TABLE knowledge_index ALTER COLUMN embedding TYPE vector(NEW_DIM);
-- ============================================================

-- ============================================================
-- 1. Create new unified knowledge index table
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge_index (
    -- Primary identification
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    project_key     TEXT NOT NULL,
    doc_id          TEXT NOT NULL,

    -- Granularity level
    granularity     TEXT NOT NULL CHECK (granularity IN ('document', 'section', 'block', 'code')),

    -- Content
    content         TEXT NOT NULL,
    embedding       vector(768),        -- Default: Ollama nomic-embed-text (768 dim)

    -- Structured metadata (JSONB for flexibility)
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Full-text search vectors
    tsv_en          tsvector GENERATED ALWAYS AS (
                        to_tsvector('english', coalesce(metadata->>'title', '') || ' ' || content)
                    ) STORED,
    tsv_zh          tsvector,           -- Needs manual update due to zhparser

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Create indexes for efficient querying
-- ============================================================

-- Composite index for user + project scoping
CREATE INDEX IF NOT EXISTS idx_ki_user_project
ON knowledge_index (user_id, project_key);

-- Index for document lookups
CREATE INDEX IF NOT EXISTS idx_ki_doc
ON knowledge_index (doc_id);

-- Index for granularity filtering
CREATE INDEX IF NOT EXISTS idx_ki_granularity
ON knowledge_index (granularity);

-- Vector similarity search (HNSW for better performance than IVFFlat)
CREATE INDEX IF NOT EXISTS idx_ki_embedding_hnsw
ON knowledge_index USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Full-text search indexes
CREATE INDEX IF NOT EXISTS idx_ki_tsv_en
ON knowledge_index USING GIN (tsv_en);

CREATE INDEX IF NOT EXISTS idx_ki_tsv_zh
ON knowledge_index USING GIN (tsv_zh);

-- Metadata GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_ki_metadata
ON knowledge_index USING GIN (metadata jsonb_path_ops);

-- ============================================================
-- 3. Create RAPTOR tree table for hierarchical summaries
-- ============================================================

CREATE TABLE IF NOT EXISTS raptor_tree (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    project_key     TEXT NOT NULL,
    doc_id          TEXT NOT NULL,       -- Root document this tree belongs to

    -- Tree structure
    level           INTEGER NOT NULL,     -- 0 = leaf (original chunks), 1+ = summary levels
    parent_id       TEXT,                 -- Parent node in the tree
    children        TEXT[] DEFAULT '{}',  -- Child node IDs

    -- Content
    content         TEXT NOT NULL,
    embedding       vector(768),          -- Must match knowledge_index dimension

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RAPTOR tree indexes
CREATE INDEX IF NOT EXISTS idx_raptor_user_project
ON raptor_tree (user_id, project_key);

CREATE INDEX IF NOT EXISTS idx_raptor_doc
ON raptor_tree (doc_id);

CREATE INDEX IF NOT EXISTS idx_raptor_level
ON raptor_tree (level);

CREATE INDEX IF NOT EXISTS idx_raptor_parent
ON raptor_tree (parent_id);

CREATE INDEX IF NOT EXISTS idx_raptor_embedding_hnsw
ON raptor_tree USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- ============================================================
-- 4. Create document summary cache table
-- ============================================================

CREATE TABLE IF NOT EXISTS document_summary_cache (
    doc_id          TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL,
    project_key     TEXT NOT NULL,
    summary         TEXT NOT NULL,
    model           TEXT,                 -- LLM model used for generation
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ           -- Optional expiration
);

CREATE INDEX IF NOT EXISTS idx_doc_summary_user_project
ON document_summary_cache (user_id, project_key);

-- ============================================================
-- 5. Create function to update tsv_zh on insert/update
-- ============================================================

CREATE OR REPLACE FUNCTION update_knowledge_index_tsv_zh()
RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv_zh := to_tsvector('zhparser',
        coalesce(NEW.metadata->>'title', '') || ' ' || NEW.content
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic tsv_zh update
DROP TRIGGER IF EXISTS trg_knowledge_index_tsv_zh ON knowledge_index;
CREATE TRIGGER trg_knowledge_index_tsv_zh
    BEFORE INSERT OR UPDATE OF content, metadata
    ON knowledge_index
    FOR EACH ROW
    EXECUTE FUNCTION update_knowledge_index_tsv_zh();

-- ============================================================
-- 6. Migration helper: Copy data from old tables (optional)
-- ============================================================

-- Note: This function can be called manually to migrate existing data
-- It will NOT run automatically during migration

CREATE OR REPLACE FUNCTION migrate_knowledge_indexes()
RETURNS void AS $$
DECLARE
    default_user_id TEXT := 'default';
BEGIN
    -- Migrate from knowledge_embedding_index
    INSERT INTO knowledge_index (
        id,
        user_id,
        project_key,
        doc_id,
        granularity,
        content,
        embedding,
        metadata,
        created_at,
        updated_at
    )
    SELECT
        project_key || ':' || doc_id || ':' || block_id || ':' || chunk_index,
        default_user_id,
        project_key,
        doc_id,
        'block',
        content,
        embedding,
        jsonb_build_object(
            'block_id', block_id,
            'chunk_index', chunk_index
        ) || COALESCE(metadata_json, '{}'::jsonb),
        updated_at,
        updated_at
    FROM knowledge_embedding_index
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Migrated % rows from knowledge_embedding_index',
        (SELECT count(*) FROM knowledge_embedding_index);

    -- Migrate from knowledge_fulltext_index (document-level only)
    INSERT INTO knowledge_index (
        id,
        user_id,
        project_key,
        doc_id,
        granularity,
        content,
        metadata,
        created_at,
        updated_at
    )
    SELECT
        project_key || ':' || doc_id || ':document',
        default_user_id,
        project_key,
        doc_id,
        'document',
        LEFT(content_plain, 500),
        jsonb_build_object('title', title) || COALESCE(metadata_json, '{}'::jsonb),
        updated_at,
        updated_at
    FROM knowledge_fulltext_index
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Migrated % rows from knowledge_fulltext_index',
        (SELECT count(*) FROM knowledge_fulltext_index);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 7. Comments for documentation
-- ============================================================

COMMENT ON TABLE knowledge_index IS
'Unified multi-granularity knowledge index supporting document, section, block, and code levels';

COMMENT ON COLUMN knowledge_index.granularity IS
'Index granularity: document (summary), section (by heading), block (paragraphs), code (with symbols)';

COMMENT ON COLUMN knowledge_index.metadata IS
'JSONB metadata including: title, block_id, path (ancestor titles), level, language, symbols';

COMMENT ON TABLE raptor_tree IS
'RAPTOR hierarchical summarization tree for recursive retrieval';

COMMENT ON TABLE document_summary_cache IS
'Cache for LLM-generated document summaries used in hierarchy context';

-- ============================================================
-- 8. Helper: Change embedding dimension (run manually if needed)
-- ============================================================
-- Uncomment and modify dimension as needed:
--
-- -- For OpenAI text-embedding-3-small (1536 dim)
-- DROP INDEX IF EXISTS idx_ki_embedding_hnsw;
-- DROP INDEX IF EXISTS idx_raptor_embedding_hnsw;
-- ALTER TABLE knowledge_index ALTER COLUMN embedding TYPE vector(1536);
-- ALTER TABLE raptor_tree ALTER COLUMN embedding TYPE vector(1536);
-- CREATE INDEX idx_ki_embedding_hnsw ON knowledge_index USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
-- CREATE INDEX idx_raptor_embedding_hnsw ON raptor_tree USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
--
-- -- For Cohere/mxbai (1024 dim)
-- DROP INDEX IF EXISTS idx_ki_embedding_hnsw;
-- DROP INDEX IF EXISTS idx_raptor_embedding_hnsw;
-- ALTER TABLE knowledge_index ALTER COLUMN embedding TYPE vector(1024);
-- ALTER TABLE raptor_tree ALTER COLUMN embedding TYPE vector(1024);
-- CREATE INDEX idx_ki_embedding_hnsw ON knowledge_index USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
-- CREATE INDEX idx_raptor_embedding_hnsw ON raptor_tree USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
