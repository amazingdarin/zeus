import React, { useState, useEffect } from 'react';
import { Card, Tabs, Form, Input, Button, Table, Tag, Space, Modal, Select, message, Popconfirm, Typography, Avatar } from 'antd';
import { UserOutlined, MailOutlined, DeleteOutlined, TeamOutlined } from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Team, TeamMember, TeamInvitation,
  getTeam, updateTeam, deleteTeam,
  listTeamMembers, updateMemberRole, removeMember,
  listInvitations, inviteMember,
  UpdateTeamRequest, InviteMemberRequest
} from '../api/teams';
import { useAuth } from '../context/AuthContext';

const { Title, Text } = Typography;

export function TeamSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [form] = Form.useForm();
  const [inviteForm] = Form.useForm();

  const isOwner = team?.owner_id === user?.id;
  const currentMember = members.find(m => m.user_id === user?.id);
  const canManage = currentMember?.role === 'owner' || currentMember?.role === 'admin';

  const fetchData = async () => {
    if (!slug) return;
    try {
      const [teamData, membersData, invitationsData] = await Promise.all([
        getTeam(slug),
        listTeamMembers(slug),
        canManage ? listInvitations(slug) : Promise.resolve([]),
      ]);
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
  }, [slug]);

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
      fetchData();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '邀请失败');
    } finally {
      setInviteLoading(false);
    }
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
        const roleColors: Record<string, string> = {
          owner: 'gold',
          admin: 'blue',
          member: 'green',
          viewer: 'default',
        };
        const roleLabels: Record<string, string> = {
          owner: '所有者',
          admin: '管理员',
          member: '成员',
          viewer: '访客',
        };
        if (!canManage || record.role === 'owner') {
          return <Tag color={roleColors[record.role]}>{roleLabels[record.role]}</Tag>;
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
        const colors: Record<string, string> = {
          pending: 'processing',
          accepted: 'success',
          expired: 'default',
          cancelled: 'error',
        };
        const labels: Record<string, string> = {
          pending: '待接受',
          accepted: '已接受',
          expired: '已过期',
          cancelled: '已取消',
        };
        return <Tag color={colors[status]}>{labels[status]}</Tag>;
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
    return <div style={{ padding: 24 }}>加载中...</div>;
  }

  if (!team) {
    return <div style={{ padding: 24 }}>团队不存在</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Space align="center">
          <Avatar icon={<TeamOutlined />} src={team.avatar_url} size={48} />
          <div>
            <Title level={3} style={{ margin: 0 }}>{team.name}</Title>
            <Text type="secondary">@{team.slug}</Text>
          </div>
        </Space>
      </div>

      <Tabs
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
                  <Button type="primary" icon={<MailOutlined />} onClick={() => setInviteModalVisible(true)}>
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
                    <Title level={5} style={{ marginTop: 24 }}>待处理邀请</Title>
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
                  <Title level={5} style={{ color: '#ff4d4f' }}>删除团队</Title>
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
        title="邀请成员"
        open={inviteModalVisible}
        onCancel={() => {
          setInviteModalVisible(false);
          inviteForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={inviteForm}
          layout="vertical"
          onFinish={handleInvite}
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
            initialValue="member"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select
              options={[
                { value: 'admin', label: '管理员 - 可管理成员和项目' },
                { value: 'member', label: '成员 - 可创建和编辑项目' },
                { value: 'viewer', label: '访客 - 只读访问' },
              ]}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => {
                setInviteModalVisible(false);
                inviteForm.resetFields();
              }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={inviteLoading}>
                发送邀请
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
