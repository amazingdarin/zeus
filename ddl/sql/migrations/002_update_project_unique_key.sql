-- =============================================
-- Migration: Update Project Unique Key Constraint
-- Version: 002
-- Description: 将 project.key 从全局唯一改为 owner 范围内唯一
-- =============================================

BEGIN;

-- 删除旧的全局唯一约束
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_key_key;

-- 添加新的复合唯一约束（同一 owner 下 key 唯一）
ALTER TABLE project ADD CONSTRAINT project_key_owner_unique UNIQUE (key, owner_type, owner_id);

-- 添加 key 索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_project_key ON project (key);

COMMIT;

-- =============================================
-- 迁移完成提示
-- =============================================
DO $$
BEGIN
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Migration 002_update_project_unique_key completed!';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Changed: project.key unique constraint now scoped to (key, owner_type, owner_id)';
    RAISE NOTICE '==============================================';
END $$;
