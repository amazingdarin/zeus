BEGIN;

CREATE TABLE IF NOT EXISTS ppt_templates
(
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_type       TEXT NOT NULL DEFAULT 'personal',
    owner_id         TEXT NOT NULL DEFAULT '',
    project_key      VARCHAR(255) NOT NULL,
    name             VARCHAR(255) NOT NULL,
    description      TEXT,
    preview_url      TEXT,
    template_images  TEXT[] DEFAULT '{}'::text[],
    color_primary    VARCHAR(7),
    color_secondary  VARCHAR(7),
    color_background VARCHAR(7),
    color_text       VARCHAR(7),
    color_accent     VARCHAR(7),
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS ppt_templates
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT '';

UPDATE ppt_templates
   SET owner_type = CASE WHEN split_part(project_key, '::', 1) = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = split_part(project_key, '::', 2)
 WHERE owner_id = '' AND project_key LIKE '%::%::%';

UPDATE ppt_templates t
   SET owner_type = CASE WHEN p.owner_type = 'team' THEN 'team' ELSE 'personal' END,
       owner_id = p.owner_id
  FROM project p
 WHERE t.owner_id = '' AND t.project_key = p.key;

UPDATE ppt_templates
   SET project_key = split_part(project_key, '::', 3)
 WHERE project_key LIKE '%::%::%';

ALTER TABLE IF EXISTS ppt_templates
  DROP CONSTRAINT IF EXISTS ppt_templates_project_key_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ppt_templates_owner_project_name
ON ppt_templates (owner_type, owner_id, project_key, name);

CREATE INDEX IF NOT EXISTS idx_ppt_owner_project
ON ppt_templates (owner_type, owner_id, project_key);

COMMIT;
