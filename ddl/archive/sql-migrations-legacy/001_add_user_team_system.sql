-- =============================================
-- Migration: Add User & Team System
-- Version: 001
-- Description: 添加用户、团队、会话、邀请表，并扩展项目表支持归属关系
-- =============================================

-- 开始事务
BEGIN;

-- =============================================
-- 1. 创建用户表
-- =============================================
CREATE TABLE IF NOT EXISTS "user"
(
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    email             TEXT NOT NULL UNIQUE,
    username          TEXT NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    display_name      TEXT,
    avatar_url        TEXT,
    status            TEXT NOT NULL DEFAULT 'active',  -- active, inactive, suspended
    email_verified_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 用户表索引
CREATE INDEX IF NOT EXISTS idx_user_email ON "user" (email);
CREATE INDEX IF NOT EXISTS idx_user_username ON "user" (username);
CREATE INDEX IF NOT EXISTS idx_user_status ON "user" (status);

COMMENT ON TABLE "user" IS '用户表';
COMMENT ON COLUMN "user".status IS 'active: 正常, inactive: 未激活, suspended: 已停用';

-- =============================================
-- 2. 创建团队表
-- =============================================
CREATE TABLE IF NOT EXISTS team
(
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,               -- URL-friendly identifier
    name        TEXT NOT NULL,
    description TEXT,
    avatar_url  TEXT,
    owner_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'active',     -- active, archived
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 团队表索引
CREATE INDEX IF NOT EXISTS idx_team_slug ON team (slug);
CREATE INDEX IF NOT EXISTS idx_team_owner ON team (owner_id);
CREATE INDEX IF NOT EXISTS idx_team_status ON team (status);

COMMENT ON TABLE team IS '团队表';
COMMENT ON COLUMN team.slug IS 'URL友好的团队标识符';
COMMENT ON COLUMN team.status IS 'active: 正常, archived: 已归档';

-- =============================================
-- 3. 创建团队成员表
-- =============================================
CREATE TABLE IF NOT EXISTS team_member
(
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'member',       -- owner, admin, member, viewer
    joined_at  TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(team_id, user_id)
);

-- 团队成员表索引
CREATE INDEX IF NOT EXISTS idx_team_member_team ON team_member (team_id);
CREATE INDEX IF NOT EXISTS idx_team_member_user ON team_member (user_id);
CREATE INDEX IF NOT EXISTS idx_team_member_role ON team_member (role);

COMMENT ON TABLE team_member IS '团队成员关联表';
COMMENT ON COLUMN team_member.role IS 'owner: 所有者, admin: 管理员, member: 成员, viewer: 访客';

-- =============================================
-- 4. 创建会话表 (用于 JWT Refresh Token)
-- =============================================
CREATE TABLE IF NOT EXISTS session
(
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,                      -- SHA256 hash of refresh token
    device_info TEXT,
    ip_address  INET,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- 会话表索引
CREATE INDEX IF NOT EXISTS idx_session_user ON session (user_id);
CREATE INDEX IF NOT EXISTS idx_session_token ON session (token_hash);
CREATE INDEX IF NOT EXISTS idx_session_expires ON session (expires_at);

COMMENT ON TABLE session IS '用户会话表，存储 Refresh Token';
COMMENT ON COLUMN session.token_hash IS 'Refresh Token 的 SHA256 哈希值';

-- =============================================
-- 5. 创建团队邀请表
-- =============================================
CREATE TABLE IF NOT EXISTS team_invitation
(
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id    TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    email      TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'member',      -- admin, member, viewer
    invited_by TEXT NOT NULL REFERENCES "user"(id),
    status     TEXT NOT NULL DEFAULT 'pending',     -- pending, accepted, expired, cancelled
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 团队邀请表索引
CREATE INDEX IF NOT EXISTS idx_invitation_team ON team_invitation (team_id);
CREATE INDEX IF NOT EXISTS idx_invitation_email ON team_invitation (email);
CREATE INDEX IF NOT EXISTS idx_invitation_status ON team_invitation (status);

COMMENT ON TABLE team_invitation IS '团队邀请表';
COMMENT ON COLUMN team_invitation.status IS 'pending: 待接受, accepted: 已接受, expired: 已过期, cancelled: 已取消';

-- =============================================
-- 6. 扩展项目表 - 添加归属字段
-- =============================================

-- 添加 owner_type 字段
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'project' AND column_name = 'owner_type'
    ) THEN
        ALTER TABLE project ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'user';
        COMMENT ON COLUMN project.owner_type IS 'user: 个人项目, team: 团队项目';
    END IF;
END $$;

-- 添加 owner_id 字段
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'project' AND column_name = 'owner_id'
    ) THEN
        ALTER TABLE project ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
        COMMENT ON COLUMN project.owner_id IS '所有者ID，user_id 或 team_id';
    END IF;
END $$;

-- 添加 visibility 字段
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'project' AND column_name = 'visibility'
    ) THEN
        ALTER TABLE project ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
        COMMENT ON COLUMN project.visibility IS 'private: 私有, team: 团队可见, public: 公开';
    END IF;
END $$;

-- 创建项目归属索引
CREATE INDEX IF NOT EXISTS idx_project_owner ON project (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_project_visibility ON project (visibility);

-- =============================================
-- 7. 创建默认系统用户 (用于单机模式和迁移)
-- =============================================
INSERT INTO "user" (id, email, username, password_hash, display_name, status)
VALUES (
    'default-user',
    'default@local.zeus',
    'default',
    '$2a$12$K8GpMVmQJFEk6P.HbOQgAe8X.V7ZRJR9C.JQ8Y5fMKd.J2yRK.hYq', -- 占位符，单机模式不验证密码
    'Default User',
    'active'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 8. 迁移现有项目 - 将无归属项目分配给默认用户
-- =============================================
UPDATE project 
SET 
    owner_type = 'user',
    owner_id = 'default-user',
    visibility = 'private'
WHERE owner_id = '' OR owner_id IS NULL;

-- =============================================
-- 9. 创建用于清理过期数据的函数
-- =============================================

-- 清理过期会话的函数
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM session WHERE expires_at < now();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 清理过期邀请的函数
CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE team_invitation 
    SET status = 'expired' 
    WHERE status = 'pending' AND expires_at < now();
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_sessions IS '清理过期的用户会话';
COMMENT ON FUNCTION cleanup_expired_invitations IS '将过期的待处理邀请标记为已过期';

-- 提交事务
COMMIT;

-- =============================================
-- 迁移完成提示
-- =============================================
DO $$
BEGIN
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Migration 001_add_user_team_system completed!';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Created tables: user, team, team_member, session, team_invitation';
    RAISE NOTICE 'Modified table: project (added owner_type, owner_id, visibility)';
    RAISE NOTICE 'Created default user: default-user';
    RAISE NOTICE '==============================================';
END $$;
