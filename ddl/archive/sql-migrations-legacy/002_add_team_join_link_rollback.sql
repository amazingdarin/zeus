-- =============================================
-- Rollback: Add Team Join Link
-- Version: 002
-- Description: 回滚团队邀请链接表
-- =============================================

BEGIN;

DROP INDEX IF EXISTS idx_team_join_link_team_role_exp;
DROP INDEX IF EXISTS idx_team_join_link_team_revoked;
DROP TABLE IF EXISTS team_join_link CASCADE;

COMMIT;
