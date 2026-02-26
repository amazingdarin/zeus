BEGIN;

DROP INDEX IF EXISTS idx_plugin_audit_project_created;
DROP INDEX IF EXISTS idx_plugin_audit_plugin_created;
DROP INDEX IF EXISTS idx_plugin_audit_user_created;
DROP TABLE IF EXISTS plugin_audit_log;

DROP TABLE IF EXISTS plugin_user_settings;

DROP INDEX IF EXISTS idx_plugin_installation_plugin_version;
DROP INDEX IF EXISTS idx_plugin_installation_user_status_updated;
DROP TABLE IF EXISTS plugin_user_installation;

COMMIT;
