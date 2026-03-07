BEGIN;

DROP INDEX IF EXISTS idx_ppt_owner_project;
DROP INDEX IF EXISTS idx_ppt_templates_owner_project_name;
DROP TABLE IF EXISTS ppt_templates;

COMMIT;
