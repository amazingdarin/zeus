import React, { useState, useEffect } from 'react';
import { Card, List, Button, Typography, Modal, Form, Input, message, Empty, Avatar, Tag, Space } from 'antd';
import { PlusOutlined, TeamOutlined, SettingOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { Team, listTeams, createTeam, CreateTeamRequest } from '../api/teams';

const { Title, Text } = Typography;

export function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const fetchTeams = async () => {
    try {
      const data = await listTeams();
      setTeams(data);
    } catch (error) {
      message.error('获取团队列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, []);

  const handleCreate = async (values: CreateTeamRequest) => {
    setCreateLoading(true);
    try {
      await createTeam(values);
      message.success('团队创建成功');
      setCreateModalVisible(false);
      form.resetFields();
      fetchTeams();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败');
    } finally {
      setCreateLoading(false);
    }
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>我的团队</Title>
        <Button 
          type="primary" 
          icon={<PlusOutlined />}
          onClick={() => setCreateModalVisible(true)}
        >
          创建团队
        </Button>
      </div>

      {teams.length === 0 && !loading ? (
        <Card>
          <Empty
            description="您还没有加入任何团队"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button type="primary" onClick={() => setCreateModalVisible(true)}>
              创建第一个团队
            </Button>
          </Empty>
        </Card>
      ) : (
        <List
          loading={loading}
          grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 3, xxl: 4 }}
          dataSource={teams}
          renderItem={(team) => (
            <List.Item>
              <Card
                hoverable
                onClick={() => navigate(`/teams/${team.slug}`)}
                actions={[
                  <Button 
                    type="text" 
                    icon={<SettingOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/teams/${team.slug}/settings`);
                    }}
                  >
                    设置
                  </Button>
                ]}
              >
                <Card.Meta
                  avatar={
                    team.avatar_url ? (
                      <Avatar src={team.avatar_url} size={48} />
                    ) : (
                      <Avatar icon={<TeamOutlined />} size={48} style={{ backgroundColor: '#1890ff' }} />
                    )
                  }
                  title={
                    <Space>
                      <span>{team.name}</span>
                      {team.status === 'archived' && <Tag color="orange">已归档</Tag>}
                    </Space>
                  }
                  description={
                    <div>
                      <Text type="secondary" style={{ display: 'block' }}>@{team.slug}</Text>
                      {team.description && (
                        <Text type="secondary" ellipsis style={{ display: 'block', marginTop: 4 }}>
                          {team.description}
                        </Text>
                      )}
                    </div>
                  }
                />
              </Card>
            </List.Item>
          )}
        />
      )}

      <Modal
        title="创建团队"
        open={createModalVisible}
        onCancel={() => {
          setCreateModalVisible(false);
          form.resetFields();
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleCreate}
        >
          <Form.Item
            name="name"
            label="团队名称"
            rules={[
              { required: true, message: '请输入团队名称' },
              { max: 100, message: '团队名称最长100个字符' }
            ]}
          >
            <Input 
              placeholder="我的团队"
              onChange={(e) => {
                const slug = generateSlug(e.target.value);
                form.setFieldValue('slug', slug);
              }}
            />
          </Form.Item>

          <Form.Item
            name="slug"
            label="团队标识"
            rules={[
              { required: true, message: '请输入团队标识' },
              { min: 3, max: 40, message: '团队标识长度应为3-40个字符' },
              { pattern: /^[a-z][a-z0-9-]*$/, message: '团队标识必须以小写字母开头，只能包含小写字母、数字和连字符' }
            ]}
            extra="用于 URL 中标识团队，创建后不可更改"
          >
            <Input placeholder="my-team" />
          </Form.Item>

          <Form.Item
            name="description"
            label="团队描述"
          >
            <Input.TextArea 
              placeholder="团队描述（可选）"
              rows={3}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => {
                setCreateModalVisible(false);
                form.resetFields();
              }}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={createLoading}>
                创建
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
