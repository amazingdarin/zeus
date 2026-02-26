-- =============================================
-- Rollback: Add User & Team System
-- Version: 001
-- Description: 回滚用户团队系统相关的表和字段
-- WARNING: 此操作将删除所有用户、团队、会话数据！
-- =============================================

-- 开始事务
BEGIN;

-- =============================================
-- 1. 删除清理函数
-- =============================================
DROP FUNCTION IF EXISTS cleanup_expired_sessions();
DROP FUNCTION IF EXISTS cleanup_expired_invitations();

-- =============================================
-- 2. 移除项目表的归属字段
-- =============================================

-- 删除索引
DROP INDEX IF EXISTS idx_project_owner;
DROP INDEX IF EXISTS idx_project_visibility;

-- 删除列
ALTER TABLE project DROP COLUMN IF EXISTS owner_type;
ALTER TABLE project DROP COLUMN IF EXISTS owner_id;
ALTER TABLE project DROP COLUMN IF EXISTS visibility;

-- =============================================
-- 3. 删除表 (按依赖顺序)
-- =============================================

-- 先删除依赖其他表的表
DROP TABLE IF EXISTS team_invitation CASCADE;
DROP TABLE IF EXISTS session CASCADE;
DROP TABLE IF EXISTS team_member CASCADE;
DROP TABLE IF EXISTS team CASCADE;
DROP TABLE IF EXISTS "user" CASCADE;

-- 提交事务
COMMIT;

-- =============================================
-- 回滚完成提示
-- =============================================
DO $$
BEGIN
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Rollback 001_add_user_team_system completed!';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Dropped tables: user, team, team_member, session, team_invitation';
    RAISE NOTICE 'Removed columns from project: owner_type, owner_id, visibility';
    RAISE NOTICE '==============================================';
END $$;
