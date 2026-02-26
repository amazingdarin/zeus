BEGIN;

DROP INDEX IF EXISTS idx_chat_messages_session;
DROP TABLE IF EXISTS chat_messages;

DROP INDEX IF EXISTS idx_chat_sessions_owner_user_project;
DROP TABLE IF EXISTS chat_sessions;

DROP INDEX IF EXISTS idx_chat_settings_singleton;
DROP TABLE IF EXISTS chat_settings;

DROP INDEX IF EXISTS idx_web_search_config_singleton;
DROP TABLE IF EXISTS web_search_config;

DROP INDEX IF EXISTS idx_project_skill_config_enabled;
DROP INDEX IF EXISTS idx_project_skill_config_source;
DROP INDEX IF EXISTS idx_project_skill_config_owner_project;
DROP TABLE IF EXISTS project_skill_config;

DROP INDEX IF EXISTS idx_skill_config_enabled;
DROP INDEX IF EXISTS idx_skill_config_category;
DROP TABLE IF EXISTS skill_config;

DROP INDEX IF EXISTS idx_llm_provider_config_type;
DROP INDEX IF EXISTS idx_llm_provider_config_provider;
DROP TABLE IF EXISTS llm_provider_config;

DROP INDEX IF EXISTS idx_document_recent_edits_user_owner_project_order;
DROP TABLE IF EXISTS document_recent_edits;

DROP INDEX IF EXISTS idx_document_favorites_user_owner_project_order;
DROP TABLE IF EXISTS document_favorites;

COMMIT;
