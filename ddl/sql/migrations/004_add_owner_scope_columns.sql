BEGIN;

-- App-backend scoped project ownership columns (non-breaking additive migration)

ALTER TABLE IF EXISTS knowledge_fulltext_index
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS knowledge_embedding_index
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS knowledge_index
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS raptor_tree
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS document_summary_cache
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS project_skill_config
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS chat_sessions
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS document_favorites
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS document_recent_edits
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ppt_templates
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

-- Backfill owner columns from scoped project_key format: {ownerType}::{ownerId}::{projectKey}
UPDATE knowledge_fulltext_index
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE knowledge_embedding_index
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE knowledge_index
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE raptor_tree
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE document_summary_cache
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE project_skill_config
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE chat_sessions
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE document_favorites
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE document_recent_edits
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE ppt_templates
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

-- Fallback backfill from project table for legacy plain project_key rows
UPDATE knowledge_fulltext_index t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE knowledge_embedding_index t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE knowledge_index t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE raptor_tree t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE document_summary_cache t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE project_skill_config t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE chat_sessions t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE document_favorites t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE document_recent_edits t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE ppt_templates t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

-- Normalize scoped project_key strings to raw key for owner-scoped tables
UPDATE knowledge_fulltext_index
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE knowledge_embedding_index
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE chat_sessions
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE document_favorites
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE document_recent_edits
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE ppt_templates
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE project_skill_config
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE knowledge_index
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE raptor_tree
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

UPDATE document_summary_cache
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

-- Rebuild legacy unique constraints to owner-scoped uniqueness
ALTER TABLE IF EXISTS knowledge_fulltext_index
  DROP CONSTRAINT IF EXISTS knowledge_fulltext_index_pkey;
ALTER TABLE IF EXISTS knowledge_fulltext_index
  ADD CONSTRAINT knowledge_fulltext_index_pkey PRIMARY KEY (owner_type, owner_id, project_key, index_name, doc_id);

ALTER TABLE IF EXISTS knowledge_embedding_index
  DROP CONSTRAINT IF EXISTS knowledge_embedding_index_pkey;
ALTER TABLE IF EXISTS knowledge_embedding_index
  ADD CONSTRAINT knowledge_embedding_index_pkey PRIMARY KEY (owner_type, owner_id, project_key, index_name, doc_id, block_id, chunk_index);

ALTER TABLE IF EXISTS document_favorites
  DROP CONSTRAINT IF EXISTS document_favorites_pkey;
ALTER TABLE IF EXISTS document_favorites
  ADD CONSTRAINT document_favorites_pkey PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id);

ALTER TABLE IF EXISTS document_recent_edits
  DROP CONSTRAINT IF EXISTS document_recent_edits_pkey;
ALTER TABLE IF EXISTS document_recent_edits
  ADD CONSTRAINT document_recent_edits_pkey PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id);

ALTER TABLE IF EXISTS project_skill_config
  DROP CONSTRAINT IF EXISTS project_skill_config_project_key_skill_id_key;
ALTER TABLE IF EXISTS project_skill_config
  ADD CONSTRAINT project_skill_config_owner_scope_skill_key UNIQUE (owner_type, owner_id, project_key, skill_id);

ALTER TABLE IF EXISTS document_summary_cache
  DROP CONSTRAINT IF EXISTS document_summary_cache_pkey;
ALTER TABLE IF EXISTS document_summary_cache
  ADD CONSTRAINT document_summary_cache_pkey PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id);

ALTER TABLE IF EXISTS ppt_templates
  DROP CONSTRAINT IF EXISTS ppt_templates_project_key_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ppt_templates_owner_project_name
  ON ppt_templates (owner_type, owner_id, project_key, name);

CREATE INDEX IF NOT EXISTS idx_kft_owner_project ON knowledge_fulltext_index (owner_type, owner_id, project_key);
CREATE INDEX IF NOT EXISTS idx_kei_owner_project ON knowledge_embedding_index (owner_type, owner_id, project_key);
CREATE INDEX IF NOT EXISTS idx_ki_owner_project ON knowledge_index (owner_type, owner_id, project_key);
CREATE INDEX IF NOT EXISTS idx_raptor_owner_project ON raptor_tree (owner_type, owner_id, project_key);
CREATE INDEX IF NOT EXISTS idx_summary_owner_project ON document_summary_cache (owner_type, owner_id, project_key);
CREATE INDEX IF NOT EXISTS idx_skill_owner_project ON project_skill_config (owner_type, owner_id, project_key);
CREATE INDEX IF NOT EXISTS idx_chat_owner_user_project ON chat_sessions (owner_type, owner_id, user_id, project_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_fav_owner_user_project ON document_favorites (owner_type, owner_id, user_id, project_key, favorited_at DESC);
CREATE INDEX IF NOT EXISTS idx_recent_owner_user_project ON document_recent_edits (owner_type, owner_id, user_id, project_key, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppt_owner_project ON ppt_templates (owner_type, owner_id, project_key);

COMMIT;
