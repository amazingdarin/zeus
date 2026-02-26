-- =============================================
-- Migration: Add Team Join Link
-- Version: 002
-- Description: 添加团队邀请链接表，支持二维码/链接加入团队
-- =============================================

BEGIN;

CREATE TABLE IF NOT EXISTS team_join_link
(
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL DEFAULT 'member',
    created_by  TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_join_link_team_role_exp
ON team_join_link (team_id, role, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_join_link_team_revoked
ON team_join_link (team_id, revoked_at);

COMMENT ON TABLE team_join_link IS '团队邀请链接';
COMMENT ON COLUMN team_join_link.token_hash IS '邀请链接 token 的 SHA256 哈希值';

COMMIT;
