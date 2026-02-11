import React, { useState, useMemo } from 'react';
import { Form, Input, Button, Card, Typography, message, Divider, Checkbox } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRememberedEmail } from '../api/auth';

const { Title, Text } = Typography;

interface LoginFormValues {
  email: string;
  password: string;
  remember_me?: boolean;
}

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const from = (location.state as { from?: string })?.from || '/';
  
  // 获取记住的邮箱
  const initialValues = useMemo(() => {
    const rememberedEmail = getRememberedEmail();
    return {
      email: rememberedEmail || '',
      remember_me: !!rememberedEmail,
    };
  }, []);

  const onFinish = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      await login(values);
      message.success('登录成功');
      navigate(from, { replace: true });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <Card className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={2} className="login-logo">Zeus</Title>
          <Text type="secondary">智能文档管理系统</Text>
        </div>
        
        <Form
          name="login"
          onFinish={onFinish}
          initialValues={initialValues}
          autoComplete="off"
          layout="vertical"
          size="large"
        >
          <Form.Item
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' }
            ]}
          >
            <Input 
              prefix={<MailOutlined />} 
              placeholder="邮箱" 
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password 
              prefix={<LockOutlined />} 
              placeholder="密码" 
            />
          </Form.Item>

          <Form.Item name="remember_me" valuePropName="checked">
            <Checkbox>7天内自动登录</Checkbox>
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
        
        <Divider>或</Divider>
        
        <div style={{ textAlign: 'center' }}>
          <Text>还没有账号？</Text>
          <Link to="/register" state={{ from }}> 立即注册</Link>
        </div>
      </Card>
    </div>
  );
}
