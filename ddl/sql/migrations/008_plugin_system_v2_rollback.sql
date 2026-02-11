BEGIN;

DROP INDEX IF EXISTS idx_plugin_registry_snapshot_user_updated;
DROP TABLE IF EXISTS plugin_user_registry_snapshot;

DROP INDEX IF EXISTS idx_plugin_audit_request_id;
DROP INDEX IF EXISTS idx_plugin_audit_event_created;

ALTER TABLE plugin_audit_log
  DROP COLUMN IF EXISTS request_id,
  DROP COLUMN IF EXISTS decision,
  DROP COLUMN IF EXISTS hook_stage,
  DROP COLUMN IF EXISTS event_type;

ALTER TABLE plugin_user_installation
  DROP COLUMN IF EXISTS activation_json,
  DROP COLUMN IF EXISTS capabilities_json,
  DROP COLUMN IF EXISTS manifest_api_version;

COMMIT;
