CREATE TABLE project (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  repo_url TEXT NOT NULL,
  repo_base_url TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (key, owner_type, owner_id)
);

CREATE INDEX idx_project_owner ON project (owner_type, owner_id);
CREATE INDEX idx_project_visibility ON project (visibility);

CREATE TABLE storage_object (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  source_upload_batch_id TEXT,
  source_url TEXT,
  source_imported_from TEXT,
  storage_type TEXT NOT NULL,
  s3_bucket TEXT,
  s3_key TEXT,
  local_base_path TEXT,
  local_file_path TEXT,
  size_bytes INTEGER,
  mime_type TEXT,
  checksum TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  project_id TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  scheduled_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  last_heartbeat TEXT,
  lock_owner TEXT,
  lock_expires_at TEXT,
  result TEXT,
  error_message TEXT,
  callback_url TEXT,
  callback_secret TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE message_center_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_current INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE INDEX idx_message_center_tasks_scope_status_updated
ON message_center_tasks (user_id, owner_type, owner_id, project_key, status, updated_at DESC);

CREATE TABLE knowledge_fulltext_index (
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  index_name TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content_plain TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (owner_type, owner_id, project_key, index_name, doc_id)
);

CREATE INDEX idx_kft_owner_project ON knowledge_fulltext_index (owner_type, owner_id, project_key);

CREATE TABLE knowledge_embedding_index (
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  index_name TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  embedding TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_type, owner_id, project_key, index_name, doc_id, block_id, chunk_index)
);

CREATE INDEX idx_kei_owner_project ON knowledge_embedding_index (owner_type, owner_id, project_key);

CREATE TABLE knowledge_index (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  granularity TEXT NOT NULL CHECK (granularity IN ('document', 'section', 'block', 'code')),
  content TEXT NOT NULL,
  embedding TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  tsv_en TEXT NOT NULL DEFAULT '',
  tsv_zh TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ki_user_owner_project ON knowledge_index (user_id, owner_type, owner_id, project_key);
CREATE INDEX idx_ki_doc ON knowledge_index (doc_id);
CREATE INDEX idx_ki_granularity ON knowledge_index (granularity);

CREATE TABLE raptor_tree (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  parent_id TEXT,
  children TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL,
  embedding TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_raptor_user_owner_project ON raptor_tree (user_id, owner_type, owner_id, project_key);
CREATE INDEX idx_raptor_doc ON raptor_tree (doc_id);
CREATE INDEX idx_raptor_level ON raptor_tree (level);
CREATE INDEX idx_raptor_parent ON raptor_tree (parent_id);

CREATE TABLE document_summary_cache (
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id)
);

CREATE INDEX idx_doc_summary_user_owner_project
ON document_summary_cache (user_id, owner_type, owner_id, project_key);

CREATE TABLE ppt_templates (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  preview_url TEXT,
  template_images TEXT NOT NULL DEFAULT '[]',
  color_primary TEXT,
  color_secondary TEXT,
  color_background TEXT,
  color_text TEXT,
  color_accent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_type, owner_id, project_key, name)
);

CREATE INDEX idx_ppt_owner_project ON ppt_templates (owner_type, owner_id, project_key);

CREATE TABLE llm_provider_config (
  id TEXT PRIMARY KEY,
  config_type TEXT NOT NULL DEFAULT 'llm',
  provider_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  default_model TEXT,
  api_key_cipher TEXT,
  api_key_iv TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT,
  last_tested_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (config_type)
);

CREATE INDEX idx_llm_provider_config_provider ON llm_provider_config (provider_id);
CREATE INDEX idx_llm_provider_config_type ON llm_provider_config (config_type);

CREATE TABLE skill_config (
  id TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_skill_config_category ON skill_config (category);
CREATE INDEX idx_skill_config_enabled ON skill_config (enabled);

INSERT INTO skill_config (id, skill_name, category, enabled, priority) VALUES
  ('skill-doc-read', 'doc-read', 'doc', 1, 10),
  ('skill-doc-create', 'doc-create', 'doc', 1, 20),
  ('skill-doc-edit', 'doc-edit', 'doc', 1, 30),
  ('skill-doc-optimize-format', 'doc-optimize-format', 'doc', 1, 40),
  ('skill-doc-optimize-content', 'doc-optimize-content', 'doc', 1, 50),
  ('skill-doc-summary', 'doc-summary', 'doc', 1, 60),
  ('skill-doc-move', 'doc-move', 'doc', 1, 70),
  ('skill-doc-delete', 'doc-delete', 'doc', 1, 80),
  ('skill-kb-search', 'kb-search', 'kb', 1, 90),
  ('skill-doc-fetch-url', 'doc-fetch-url', 'doc', 1, 100),
  ('skill-doc-import-git', 'doc-import-git', 'doc', 1, 110),
  ('skill-doc-convert', 'doc-convert', 'doc', 1, 120)
ON CONFLICT (skill_name) DO NOTHING;

CREATE TABLE project_skill_config (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  source TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  priority INTEGER NOT NULL DEFAULT 0,
  risk_override TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_type, owner_id, project_key, skill_id)
);

CREATE INDEX idx_project_skill_config_owner_project ON project_skill_config (owner_type, owner_id, project_key);
CREATE INDEX idx_project_skill_config_source ON project_skill_config (source);
CREATE INDEX idx_project_skill_config_enabled ON project_skill_config (enabled);

CREATE TABLE web_search_config (
  id TEXT PRIMARY KEY,
  singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,
  provider TEXT NOT NULL,
  api_key_cipher TEXT,
  api_key_iv TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_general_settings (
  user_id TEXT PRIMARY KEY,
  use_remote_knowledge_base INTEGER NOT NULL DEFAULT 0 CHECK (use_remote_knowledge_base IN (0, 1)),
  document_auto_sync INTEGER NOT NULL DEFAULT 0 CHECK (document_auto_sync IN (0, 1)),
  trash_auto_cleanup_enabled INTEGER NOT NULL DEFAULT 0 CHECK (trash_auto_cleanup_enabled IN (0, 1)),
  trash_auto_cleanup_days INTEGER NOT NULL DEFAULT 30 CHECK (trash_auto_cleanup_days >= 1 AND trash_auto_cleanup_days <= 3650),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chat_settings (
  id TEXT PRIMARY KEY,
  singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1) UNIQUE,
  full_access INTEGER NOT NULL DEFAULT 0 CHECK (full_access IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO chat_settings (id, full_access) VALUES ('default', 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '新对话',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chat_sessions_owner_user_project
ON chat_sessions (owner_type, owner_id, user_id, project_key, updated_at DESC);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sources TEXT,
  artifacts TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_messages_session ON chat_messages (session_id, created_at);

CREATE TABLE document_favorites (
  user_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  favorited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id)
);

CREATE INDEX idx_document_favorites_user_owner_project_order
ON document_favorites (user_id, owner_type, owner_id, project_key, favorited_at DESC);

CREATE TABLE document_recent_edits (
  user_id TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'personal',
  owner_id TEXT NOT NULL DEFAULT '',
  project_key TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  edited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, owner_type, owner_id, project_key, doc_id)
);

CREATE INDEX idx_document_recent_edits_user_owner_project_order
ON document_recent_edits (user_id, owner_type, owner_id, project_key, edited_at DESC);

CREATE TABLE plugin_user_installation (
  user_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'installed',
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  manifest_api_version INTEGER NOT NULL DEFAULT 2,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  activation_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, plugin_id)
);

CREATE INDEX idx_plugin_installation_user_status_updated
ON plugin_user_installation (user_id, status, updated_at DESC);

CREATE INDEX idx_plugin_installation_plugin_version
ON plugin_user_installation (plugin_id, version);

CREATE TABLE plugin_user_settings (
  user_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, plugin_id)
);

CREATE TABLE plugin_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  project_scope TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  error TEXT,
  event_type TEXT NOT NULL DEFAULT 'operation',
  hook_stage TEXT,
  decision TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_plugin_audit_user_created ON plugin_audit_log (user_id, created_at DESC);
CREATE INDEX idx_plugin_audit_plugin_created ON plugin_audit_log (plugin_id, created_at DESC);
CREATE INDEX idx_plugin_audit_project_created ON plugin_audit_log (project_scope, created_at DESC);
CREATE INDEX idx_plugin_audit_event_created ON plugin_audit_log (event_type, created_at DESC);
CREATE INDEX idx_plugin_audit_request_id ON plugin_audit_log (request_id);

CREATE TABLE plugin_user_registry_snapshot (
  user_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  version TEXT NOT NULL,
  commands_json TEXT NOT NULL DEFAULT '[]',
  hooks_json TEXT NOT NULL DEFAULT '[]',
  routes_json TEXT NOT NULL DEFAULT '[]',
  tools_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, plugin_id)
);

CREATE INDEX idx_plugin_registry_snapshot_user_updated
ON plugin_user_registry_snapshot (user_id, updated_at DESC);
