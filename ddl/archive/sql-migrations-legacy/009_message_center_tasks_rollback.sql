BEGIN;

DROP INDEX IF EXISTS idx_message_center_tasks_scope_status_updated;
DROP TABLE IF EXISTS message_center_tasks;

COMMIT;
