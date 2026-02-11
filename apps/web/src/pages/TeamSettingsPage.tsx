import React, { useState, useEffect, useMemo } from 'react';
import { Card, Tabs, Form, Input, Button, Table, Tag, Space, Modal, Select, message, Popconfirm, Typography, Avatar, QRCode } from 'antd';
import { UserOutlined, MailOutlined, DeleteOutlined, TeamOutlined, LinkOutlined, CopyOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  Team, TeamMember, TeamInvitation, TeamJoinLink,
  getTeam, updateTeam, deleteTeam,
  listTeamMembers, updateMemberRole, removeMember,
  listInvitations, inviteMember, createTeamJoinLink,
  UpdateTeamRequest, InviteMemberRequest
} from '../api/teams';
import { useAuth } from '../context/AuthContext';

const { Title, Text } = Typography;

export function TeamSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteTab, setInviteTab] = useState<'email' | 'link'>('email');
  const [joinLinkRole, setJoinLinkRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [joinLinkLoading, setJoinLinkLoading] = useState(false);
  const [joinLink, setJoinLink] = useState<TeamJoinLink | null>(null);
  const [form] = Form.useForm();
  const [inviteForm] = Form.useForm();

  const isOwner = team?.owner_id === user?.id;
  const currentMember = members.find(m => m.user_id === user?.id);
  const canManage = currentMember?.role === 'owner' || currentMember?.role === 'admin';
  const isSettingsRoute = location.pathname.endsWith('/settings');

  const inviteLinkUrl = useMemo(() => {
    if (!joinLink) {
      return '';
    }
    return `${window.location.origin}${window.location.pathname}${window.location.search}#/invite/${encodeURIComponent(joinLink.token)}`;
  }, [joinLink]);

  const fetchData = async () => {
    if (!slug) return;
    try {
      const [teamData, membersData] = await Promise.all([
        getTeam(slug),
        listTeamMembers(slug),
      ]);
      const member = membersData.find(m => m.user_id === user?.id);
      const canManageMembers = member?.role === 'owner' || member?.role === 'admin';
      const invitationsData = canManageMembers ? await listInvitations(slug) : [];
      setTeam(teamData);
      setMembers(membersData);
      setInvitations(invitationsData);
      form.setFieldsValue({
        name: teamData.name,
        description: teamData.description,
      });
    } catch (error) {
      message.error('获取团队信息失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [slug, user?.id]);

  const handleUpdateTeam = async (values: UpdateTeamRequest) => {
    if (!slug) return;
    try {
      await updateTeam(slug, values);
      message.success('团队信息已更新');
      fetchData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新失败');
    }
  };

  const handleDeleteTeam = async () => {
    if (!slug) return;
    try {
      await deleteTeam(slug);
      message.success('团队已删除');
      navigate('/teams');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    if (!slug) return;
    try {
      await updateMemberRole(slug, userId, role);
      message.success('角色已更新');
      fetchData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新失败');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!slug) return;
    try {
      await removeMember(slug, userId);
      message.success('成员已移除');
      fetchData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移除失败');
    }
  };

  const handleInvite = async (values: InviteMemberRequest) => {
    if (!slug) return;
    setInviteLoading(true);
    try {
      await inviteMember(slug, values);
      message.success('邀请已发送');
      setInviteModalVisible(false);
      inviteForm.resetFields();
      inviteForm.setFieldValue('role', 'member');
      fetchData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '邀请失败');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCreateJoinLink = async () => {
    if (!slug) return;
    setJoinLinkLoading(true);
    try {
      const link = await createTeamJoinLink(slug, { role: joinLinkRole });
      setJoinLink(link);
      message.success('邀请链接已生成');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成邀请链接失败');
    } finally {
      setJoinLinkLoading(false);
    }
  };

  const handleCopyJoinLink = async () => {
    if (!inviteLinkUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLinkUrl);
      message.success('邀请链接已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  };

  const openInviteModal = () => {
    setInviteModalVisible(true);
    setInviteTab('email');
    setJoinLinkRole('member');
    setJoinLink(null);
    inviteForm.resetFields();
    inviteForm.setFieldValue('role', 'member');
  };

  const closeInviteModal = () => {
    setInviteModalVisible(false);
    setInviteTab('email');
    setJoinLinkRole('member');
    setJoinLink(null);
    inviteForm.resetFields();
    inviteForm.setFieldValue('role', 'member');
  };

  const memberColumns = [
    {
      title: '成员',
      key: 'user',
      render: (_: unknown, record: TeamMember) => (
        <Space>
          <Avatar icon={<UserOutlined />} src={record.user?.avatar_url} />
          <div>
            <div>{record.user?.display_name || record.user?.username}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>@{record.user?.username}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: '角色',
      key: 'role',
      render: (_: unknown, record: TeamMember) => {
        const roleClassNames: Record<string, string> = {
          owner: 'team-role-tag-owner',
          admin: 'team-role-tag-admin',
          member: 'team-role-tag-member',
          viewer: 'team-role-tag-viewer',
        };
        const roleLabels: Record<string, string> = {
          owner: '所有者',
          admin: '管理员',
          member: '成员',
          viewer: '访客',
        };
        if (!canManage || record.role === 'owner') {
          const roleClassName = roleClassNames[record.role] || 'team-role-tag-viewer';
          return <Tag className={`team-role-tag ${roleClassName}`}>{roleLabels[record.role] || record.role}</Tag>;
        }
        return (
          <Select
            value={record.role}
            style={{ width: 100 }}
            onChange={(value) => handleRoleChange(record.user_id, value)}
            options={[
              { value: 'admin', label: '管理员' },
              { value: 'member', label: '成员' },
              { value: 'viewer', label: '访客' },
            ]}
          />
        );
      },
    },
    {
      title: '加入时间',
      dataIndex: 'joined_at',
      key: 'joined_at',
      render: (date: string) => new Date(date).toLocaleDateString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: TeamMember) => {
        if (record.role === 'owner' || !canManage) return null;
        return (
          <Popconfirm
            title="确定要移除该成员吗？"
            onConfirm={() => handleRemoveMember(record.user_id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        );
      },
    },
  ];

  const invitationColumns = [
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        const labels: Record<string, string> = {
          admin: '管理员',
          member: '成员',
          viewer: '访客',
        };
        return labels[role] || role;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const statusClassNames: Record<string, string> = {
          pending: 'team-status-tag-pending',
          accepted: 'team-status-tag-accepted',
          expired: 'team-status-tag-expired',
          cancelled: 'team-status-tag-cancelled',
        };
        const labels: Record<string, string> = {
          pending: '待接受',
          accepted: '已接受',
          expired: '已过期',
          cancelled: '已取消',
        };
        const statusClassName = statusClassNames[status] || 'team-status-tag-expired';
        return <Tag className={`team-status-tag ${statusClassName}`}>{labels[status] || status}</Tag>;
      },
    },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      key: 'expires_at',
      render: (date: string) => new Date(date).toLocaleString(),
    },
  ];

  if (loading) {
    return (
      <div className="team-settings-page">
        <div className="team-settings-status">加载中...</div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="team-settings-page">
        <div className="team-settings-status">团队不存在</div>
      </div>
    );
  }

  return (
    <div className="team-settings-page">
      <div className="team-settings-header">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          className="team-settings-back-btn"
          onClick={() => navigate('/teams')}
        >
          返回团队列表
        </Button>
        <Space align="center">
          <Avatar icon={<TeamOutlined />} src={team.avatar_url} size={48} />
          <div>
            <Title level={3} style={{ margin: 0 }} className="team-settings-name">{team.name}</Title>
            <Text type="secondary" className="team-settings-slug">@{team.slug}</Text>
          </div>
        </Space>
      </div>

      <Tabs
        key={isSettingsRoute ? 'settings' : 'detail'}
        defaultActiveKey={isSettingsRoute ? 'general' : 'members'}
        className="team-settings-tabs"
        items={[
          {
            key: 'general',
            label: '基本信息',
            children: (
              <Card>
                <Form
                  form={form}
                  layout="vertical"
                  onFinish={handleUpdateTeam}
                  disabled={!canManage}
                >
                  <Form.Item
                    name="name"
                    label="团队名称"
                    rules={[{ required: true, message: '请输入团队名称' }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="description"
                    label="团队描述"
                  >
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  {canManage && (
                    <Form.Item>
                      <Button type="primary" htmlType="submit">
                        保存更改
                      </Button>
                    </Form.Item>
                  )}
                </Form>
              </Card>
            ),
          },
          {
            key: 'members',
            label: '成员管理',
            children: (
              <Card
                title="团队成员"
                extra={canManage && (
                  <Button type="primary" icon={<MailOutlined />} onClick={openInviteModal}>
                    邀请成员
                  </Button>
                )}
              >
                <Table
                  dataSource={members}
                  columns={memberColumns}
                  rowKey="id"
                  pagination={false}
                />
                
                {canManage && invitations.length > 0 && (
                  <>
                    <Title level={5} className="team-settings-subsection-title">待处理邀请</Title>
                    <Table
                      dataSource={invitations.filter(i => i.status === 'pending')}
                      columns={invitationColumns}
                      rowKey="id"
                      pagination={false}
                    />
                  </>
                )}
              </Card>
            ),
          },
          ...(isOwner ? [{
            key: 'danger',
            label: '危险操作',
            children: (
              <Card>
                <div style={{ marginBottom: 16 }}>
                  <Title level={5} className="team-settings-danger-title">删除团队</Title>
                  <Text type="secondary">
                    删除团队后，所有团队项目和数据将被永久删除，此操作不可恢复。
                  </Text>
                </div>
                <Popconfirm
                  title="确定要删除这个团队吗？"
                  description="此操作不可恢复"
                  onConfirm={handleDeleteTeam}
                  okText="确定删除"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger>删除团队</Button>
                </Popconfirm>
              </Card>
            ),
          }] : []),
        ]}
      />

      <Modal
        className="team-invite-modal"
        title="邀请成员"
        open={inviteModalVisible}
        onCancel={closeInviteModal}
        footer={null}
      >
        <Tabs
          activeKey={inviteTab}
          onChange={(key) => setInviteTab(key as 'email' | 'link')}
          items={[
            {
              key: 'email',
              label: '邮箱邀请',
              children: (
                <Form
                  form={inviteForm}
                  layout="vertical"
                  onFinish={handleInvite}
                  initialValues={{ role: 'member' }}
                >
                  <Form.Item
                    name="email"
                    label="邮箱地址"
                    rules={[
                      { required: true, message: '请输入邮箱' },
                      { type: 'email', message: '请输入有效的邮箱地址' }
                    ]}
                  >
                    <Input placeholder="member@example.com" />
                  </Form.Item>
                  <Form.Item
                    name="role"
                    label="角色"
                    rules={[{ required: true, message: '请选择角色' }]}
                  >
                    <Select
                      className="team-invite-role-select"
                      popupClassName="team-invite-select-dropdown"
                      options={[
                        { value: 'admin', label: '管理员 - 可管理成员和项目' },
                        { value: 'member', label: '成员 - 可创建和编辑项目' },
                        { value: 'viewer', label: '访客 - 只读访问' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                    <Space>
                      <Button onClick={closeInviteModal}>取消</Button>
                      <Button type="primary" htmlType="submit" loading={inviteLoading}>
                        发送邀请
                      </Button>
                    </Space>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'link',
              label: '链接邀请',
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Form layout="vertical">
                    <Form.Item label="加入角色">
                      <Select
                        className="team-invite-role-select"
                        popupClassName="team-invite-select-dropdown"
                        value={joinLinkRole}
                        onChange={(value) => setJoinLinkRole(value as 'admin' | 'member' | 'viewer')}
                        options={[
                          { value: 'admin', label: '管理员 - 可管理成员和项目' },
                          { value: 'member', label: '成员 - 可创建和编辑项目' },
                          { value: 'viewer', label: '访客 - 只读访问' },
                        ]}
                      />
                    </Form.Item>
                  </Form>

                  <Space>
                    <Button
                      type="primary"
                      icon={<LinkOutlined />}
                      loading={joinLinkLoading}
                      onClick={handleCreateJoinLink}
                    >
                      {joinLink ? '重新生成链接' : '生成邀请链接'}
                    </Button>
                    <Text type="secondary" className="team-invite-link-hint">7 天有效；重新生成后旧链接会失效</Text>
                  </Space>

                  {joinLink ? (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Input
                        value={inviteLinkUrl}
                        readOnly
                        addonAfter={
                          <Button type="text" icon={<CopyOutlined />} onClick={handleCopyJoinLink}>
                            复制
                          </Button>
                        }
                      />
                      <Space align="start" size={20}>
                        <div className="team-invite-qr">
                          <QRCode value={inviteLinkUrl} size={160} />
                        </div>
                        <div>
                          <Text className="team-invite-qr-title" style={{ display: 'block' }}>
                            扫码可加入团队（需先登录）
                          </Text>
                          <Text type="secondary" className="team-invite-qr-expire">
                            过期时间：{new Date(joinLink.expires_at).toLocaleString()}
                          </Text>
                        </div>
                      </Space>
                    </Space>
                  ) : null}

                  <div style={{ textAlign: 'right' }}>
                    <Button onClick={closeInviteModal}>关闭</Button>
                  </div>
                </Space>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}
