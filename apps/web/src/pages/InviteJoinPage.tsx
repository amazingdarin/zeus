import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Result, Space, Spin, Tag, Typography } from 'antd';
import { TeamOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';

import { getInviteLinkPreview, joinTeamByInviteLink, TeamJoinLinkPreview, TeamJoinResult } from '../api/teams';
import { useAuth } from '../context/AuthContext';
import { useProjectContext } from '../context/ProjectContext';

const { Title, Text } = Typography;

const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  member: '成员',
  viewer: '访客',
};

export function InviteJoinPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const { reloadProjects } = useProjectContext();

  const [preview, setPreview] = useState<TeamJoinLinkPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewErrorCode, setPreviewErrorCode] = useState<string | null>(null);
  const [previewErrorMessage, setPreviewErrorMessage] = useState<string | null>(null);

  const [joining, setJoining] = useState(false);
  const [joinErrorMessage, setJoinErrorMessage] = useState<string | null>(null);
  const [joinResult, setJoinResult] = useState<TeamJoinResult | null>(null);
  const joinAttemptedRef = useRef(false);

  const invitePath = useMemo(() => (token ? `/invite/${token}` : '/'), [token]);

  useEffect(() => {
    if (!token) {
      setPreviewErrorCode('INVITE_LINK_NOT_FOUND');
      setPreviewErrorMessage('邀请链接无效');
      setPreviewLoading(false);
      return;
    }

    let mounted = true;
    setPreviewLoading(true);
    setPreview(null);
    setPreviewErrorCode(null);
    setPreviewErrorMessage(null);
    setJoinResult(null);
    setJoinErrorMessage(null);
    joinAttemptedRef.current = false;

    getInviteLinkPreview(token)
      .then((data) => {
        if (!mounted) {
          return;
        }
        setPreview(data);
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }
        const apiError = error as Error & { code?: string };
        setPreviewErrorCode(apiError.code || null);
        setPreviewErrorMessage(apiError.message || '邀请链接不可用');
      })
      .finally(() => {
        if (mounted) {
          setPreviewLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [token]);

  const doJoin = useCallback(async () => {
    if (!token || joinAttemptedRef.current) {
      return;
    }
    joinAttemptedRef.current = true;
    setJoining(true);
    setJoinErrorMessage(null);
    try {
      const result = await joinTeamByInviteLink(token);
      setJoinResult(result);
      void reloadProjects().catch(() => undefined);
    } catch (error) {
      const apiError = error as Error & { code?: string };
      setJoinErrorMessage(apiError.message || '加入团队失败');
      joinAttemptedRef.current = false;
    } finally {
      setJoining(false);
    }
  }, [token, reloadProjects]);

  useEffect(() => {
    if (!preview || previewLoading || joinResult) {
      return;
    }
    if (isLoading) {
      return;
    }
    if (!isAuthenticated) {
      navigate('/login', {
        replace: true,
        state: {
          from: invitePath,
        },
      });
      return;
    }
    void doJoin();
  }, [preview, previewLoading, isLoading, isAuthenticated, navigate, invitePath, doJoin, joinResult]);

  if (previewLoading) {
    return (
      <div className="invite-join-page">
        <Card className="invite-join-card">
          <Space direction="vertical" align="center" size={16} style={{ width: '100%' }}>
            <Spin size="large" />
            <Text type="secondary">正在加载邀请信息...</Text>
          </Space>
        </Card>
      </div>
    );
  }

  if (!preview) {
    const isExpired = previewErrorCode === 'INVITE_LINK_EXPIRED';
    return (
      <div className="invite-join-page">
        <Card className="invite-join-card">
          <Result
            status={isExpired ? 'warning' : '404'}
            icon={isExpired ? <ExclamationCircleOutlined /> : undefined}
            title={isExpired ? '邀请链接已过期' : '邀请链接不可用'}
            subTitle={previewErrorMessage || '该邀请链接不存在或已失效'}
            extra={
              <Button type="primary" onClick={() => navigate('/documents')}>
                返回首页
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (joinResult) {
    return (
      <div className="invite-join-page">
        <Card className="invite-join-card">
          <Result
            status="success"
            icon={<CheckCircleOutlined />}
            title="已加入团队"
            subTitle={`你已成功加入团队「${joinResult.team_name}」`}
            extra={
              <Space>
                <Button type="primary" onClick={() => navigate(`/teams/${joinResult.team_slug}`)}>
                  进入团队
                </Button>
                <Button onClick={() => navigate('/documents')}>返回文档</Button>
              </Space>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="invite-join-page">
      <Card className="invite-join-card">
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Space align="center" size={12}>
            <TeamOutlined style={{ fontSize: 24, color: '#1677ff' }} />
            <div>
              <Title level={4} style={{ margin: 0 }}>
                加入团队邀请
              </Title>
              <Text type="secondary">请确认团队信息</Text>
            </div>
          </Space>

          <div className="invite-join-meta">
            <div>
              <Text type="secondary">团队</Text>
              <div className="invite-join-value">{preview.team_name}</div>
            </div>
            <div>
              <Text type="secondary">角色</Text>
              <div>
                <Tag className={`team-role-tag team-role-tag-${preview.role}`}>{ROLE_LABELS[preview.role] || preview.role}</Tag>
              </div>
            </div>
            <div>
              <Text type="secondary">过期时间</Text>
              <div className="invite-join-value">{new Date(preview.expires_at).toLocaleString()}</div>
            </div>
          </div>

          {joinErrorMessage ? (
            <Alert
              type="error"
              showIcon
              message={joinErrorMessage}
              action={
                <Button type="link" size="small" onClick={() => void doJoin()}>
                  重试
                </Button>
              }
            />
          ) : null}

          <Space>
            <Button type="primary" loading={joining} onClick={() => void doJoin()}>
              {joining ? '正在加入...' : '加入团队'}
            </Button>
            <Button onClick={() => navigate('/documents')}>取消</Button>
          </Space>
        </Space>
      </Card>
    </div>
  );
}

