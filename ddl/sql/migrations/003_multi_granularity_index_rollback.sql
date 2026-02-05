-- Rollback Migration: Multi-Granularity Knowledge Index
-- WARNING: This will delete all multi-granularity index data!

-- Drop triggers
DROP TRIGGER IF EXISTS trg_knowledge_index_tsv_zh ON knowledge_index;

-- Drop functions
DROP FUNCTION IF EXISTS update_knowledge_index_tsv_zh();
DROP FUNCTION IF EXISTS migrate_knowledge_indexes();

-- Drop tables
DROP TABLE IF EXISTS document_summary_cache;
DROP TABLE IF EXISTS raptor_tree;
DROP TABLE IF EXISTS knowledge_index;
