BEGIN;

DROP INDEX IF EXISTS idx_kft_owner_project;
DROP INDEX IF EXISTS idx_kei_owner_project;
DROP INDEX IF EXISTS idx_ki_owner_project;
DROP INDEX IF EXISTS idx_raptor_owner_project;
DROP INDEX IF EXISTS idx_summary_owner_project;
DROP INDEX IF EXISTS idx_skill_owner_project;
DROP INDEX IF EXISTS idx_chat_owner_user_project;
DROP INDEX IF EXISTS idx_fav_owner_user_project;
DROP INDEX IF EXISTS idx_recent_owner_user_project;
DROP INDEX IF EXISTS idx_ppt_owner_project;

ALTER TABLE IF EXISTS knowledge_fulltext_index DROP CONSTRAINT IF EXISTS knowledge_fulltext_index_pkey;
ALTER TABLE IF EXISTS knowledge_fulltext_index ADD CONSTRAINT knowledge_fulltext_index_pkey PRIMARY KEY (project_key, index_name, doc_id);

ALTER TABLE IF EXISTS knowledge_embedding_index DROP CONSTRAINT IF EXISTS knowledge_embedding_index_pkey;
ALTER TABLE IF EXISTS knowledge_embedding_index ADD CONSTRAINT knowledge_embedding_index_pkey PRIMARY KEY (project_key, index_name, doc_id, block_id, chunk_index);

ALTER TABLE IF EXISTS document_favorites DROP CONSTRAINT IF EXISTS document_favorites_pkey;
ALTER TABLE IF EXISTS document_favorites ADD CONSTRAINT document_favorites_pkey PRIMARY KEY (user_id, project_key, doc_id);

ALTER TABLE IF EXISTS document_recent_edits DROP CONSTRAINT IF EXISTS document_recent_edits_pkey;
ALTER TABLE IF EXISTS document_recent_edits ADD CONSTRAINT document_recent_edits_pkey PRIMARY KEY (user_id, project_key, doc_id);

ALTER TABLE IF EXISTS project_skill_config DROP CONSTRAINT IF EXISTS project_skill_config_owner_scope_skill_key;
ALTER TABLE IF EXISTS project_skill_config ADD CONSTRAINT project_skill_config_project_key_skill_id_key UNIQUE (project_key, skill_id);

ALTER TABLE IF EXISTS document_summary_cache DROP CONSTRAINT IF EXISTS document_summary_cache_pkey;
ALTER TABLE IF EXISTS document_summary_cache ADD CONSTRAINT document_summary_cache_pkey PRIMARY KEY (doc_id);

DROP INDEX IF EXISTS idx_ppt_templates_owner_project_name;
ALTER TABLE IF EXISTS ppt_templates ADD CONSTRAINT ppt_templates_project_key_name_key UNIQUE (project_key, name);

ALTER TABLE IF EXISTS knowledge_fulltext_index DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS knowledge_fulltext_index DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS knowledge_embedding_index DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS knowledge_embedding_index DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS knowledge_index DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS knowledge_index DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS raptor_tree DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS raptor_tree DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS document_summary_cache DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS document_summary_cache DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS project_skill_config DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS project_skill_config DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS chat_sessions DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS chat_sessions DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS document_favorites DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS document_favorites DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS document_recent_edits DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS document_recent_edits DROP COLUMN IF EXISTS owner_id;

ALTER TABLE IF EXISTS ppt_templates DROP COLUMN IF EXISTS owner_type;
ALTER TABLE IF EXISTS ppt_templates DROP COLUMN IF EXISTS owner_id;

COMMIT;
