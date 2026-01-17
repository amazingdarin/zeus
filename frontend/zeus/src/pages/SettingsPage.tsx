import { useCallback, useEffect, useState } from "react";
import { 
  Typography, 
  Card, 
  List, 
  Button, 
  Tag, 
  Modal, 
  Form, 
  Input, 
  Select, 
  message, 
  Space, 
  Badge 
} from "antd";
import { 
  PlusOutlined, 
  CloudServerOutlined, 
  SafetyCertificateOutlined, 
  CheckCircleOutlined, 
  CloseCircleOutlined, 
  EditOutlined 
} from "@ant-design/icons";

import { 
  fetchProviders, 
  fetchConnections, 
  upsertConnection, 
  startDeviceAuth, 
  pollDeviceAuth, 
  storeApiKey,
  type ProviderDefinition, 
  type ProviderConnection 
} from "../api/provider";

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

function SettingsPage() {
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ProviderConnection | null>(null);
  
  const [authStep, setAuthStep] = useState<"select" | "input" | "device">("select");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [deviceCodeData, setDeviceCodeData] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [form] = Form.useForm();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [provs, conns] = await Promise.all([fetchProviders(), fetchConnections()]);
      setProviders(provs);
      setConnections(conns);
    } catch (err) {
      message.error("Failed to load settings data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddConnection = () => {
    setEditingConnection(null);
    setAuthStep("select");
    setSelectedProviderId("");
    setDeviceCodeData(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEditConnection = (conn: ProviderConnection) => {
    setEditingConnection(conn);
    setSelectedProviderId(conn.providerId);
    setAuthStep("input"); 
    form.setFieldsValue({
      displayName: conn.displayName,
      modelName: conn.modelName,
      baseUrl: conn.baseUrl,
      apiKey: "",
    });
    setModalVisible(true);
  };

  const handleProviderSelect = (providerId: string) => {
    setSelectedProviderId(providerId);
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;

    if (provider.authType === "device_code") {
      setAuthStep("device");
      initiateDeviceAuth(providerId);
    } else {
      setAuthStep("input");
    }
  };

  const initiateDeviceAuth = async (providerId: string) => {
    try {
      const data = await startDeviceAuth(providerId);
      setDeviceCodeData({ userCode: data.userCode, verificationUri: data.verificationUri });
      
      const poller = setInterval(async () => {
        try {
          const result = await pollDeviceAuth(providerId, data.deviceCode);
          if (result.accessToken) {
            clearInterval(poller);
            await storeApiKey(providerId, result.accessToken);
            message.success("Device authentication successful!");
            setAuthStep("input");
          }
        } catch (e) {}
      }, data.interval * 1000);
    } catch (err) {
      message.error("Failed to start device authentication");
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      await upsertConnection({
        providerId: selectedProviderId,
        displayName: values.displayName,
        modelName: values.modelName,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
      });
      message.success("Connection saved successfully");
      setModalVisible(false);
      loadData();
    } catch (err) {
      message.error("Failed to save connection");
    }
  };

  const selectedProvider = providers.find(p => p.id === selectedProviderId);

  return (
    <div className="settings-page" style={{ padding: "24px", maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <Title level={2}>Settings</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddConnection}>
          Add Connection
        </Button>
      </div>

      <Card title="Provider Connections" loading={loading}>
        <List
          dataSource={connections}
          renderItem={(item) => {
             const provider = providers.find(p => p.id === item.providerId);
             return (
              <List.Item
                actions={[
                  <Button key="edit" type="text" icon={<EditOutlined />} onClick={() => handleEditConnection(item)}>
                    Edit
                  </Button>
                ]}
              >
                <List.Item.Meta
                  avatar={<CloudServerOutlined style={{ fontSize: "24px", color: "#1890ff" }} />}
                  title={
                    <Space>
                      {item.displayName}
                      <Tag color="blue">{provider?.name || item.providerId}</Tag>
                      {item.status === "active" ? (
                        <Badge status="success" text="Active" />
                      ) : (
                        <Badge status="error" text="Error" />
                      )}
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={0}>
                      <Text type="secondary">Model: {item.modelName}</Text>
                      {item.baseUrl && <Text type="secondary" style={{ fontSize: "12px" }}>Base URL: {item.baseUrl}</Text>}
                      {item.lastError && <Text type="danger" style={{ fontSize: "12px" }}>Error: {item.lastError}</Text>}
                    </Space>
                  }
                />
              </List.Item>
             );
          }}
        />
      </Card>

      <Modal
        title={editingConnection ? "Edit Connection" : "New Connection"}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={600}
      >
        {authStep === "select" && (
          <List
            grid={{ gutter: 16, column: 2 }}
            dataSource={providers}
            renderItem={(item) => (
              <List.Item>
                <Card 
                  hoverable 
                  onClick={() => handleProviderSelect(item.id)}
                  style={{ textAlign: "center", height: "100%" }}
                >
                  <CloudServerOutlined style={{ fontSize: "32px", marginBottom: "16px", color: "#1890ff" }} />
                  <Title level={5}>{item.name}</Title>
                  <Paragraph type="secondary" ellipsis={{ rows: 2 }}>{item.description}</Paragraph>
                  <Tag>{item.authType}</Tag>
                </Card>
              </List.Item>
            )}
          />
        )}

        {authStep === "device" && deviceCodeData && (
          <div style={{ textAlign: "center", padding: "24px" }}>
            <SafetyCertificateOutlined style={{ fontSize: "48px", color: "#52c41a", marginBottom: "16px" }} />
            <Title level={4}>Device Authentication</Title>
            <Paragraph>
              Please visit <a href={deviceCodeData.verificationUri} target="_blank" rel="noopener noreferrer">{deviceCodeData.verificationUri}</a> and enter the code below:
            </Paragraph>
            <Title level={2} copyable>{deviceCodeData.userCode}</Title>
            <Paragraph type="secondary">Waiting for authentication...</Paragraph>
          </div>
        )}

        {authStep === "input" && (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{
              modelName: "gpt-4-turbo", 
            }}
          >
            <Form.Item label="Provider">
               <Input value={selectedProvider?.name} disabled prefix={<CloudServerOutlined />} />
            </Form.Item>

            <Form.Item 
              name="displayName" 
              label="Display Name" 
              rules={[{ required: true, message: "Please enter a display name" }]}
            >
              <Input placeholder="My OpenAI Connection" />
            </Form.Item>

            <Form.Item 
              name="modelName" 
              label="Default Model" 
              rules={[{ required: true, message: "Please enter a model name" }]}
            >
              <Input placeholder="gpt-4" />
            </Form.Item>

            {selectedProvider?.isCustom && (
              <Form.Item 
                name="baseUrl" 
                label="Base URL" 
                rules={[{ required: true, message: "Please enter the API Base URL" }]}
              >
                <Input placeholder="https://api.example.com/v1" />
              </Form.Item>
            )}

            {selectedProvider?.authType === "api_key" && (
              <Form.Item 
                name="apiKey" 
                label="API Key" 
                extra="Leave blank to keep existing key"
                rules={[{ required: !editingConnection, message: "API Key is required" }]}
              >
                <Input.Password placeholder="sk-..." />
              </Form.Item>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <Button onClick={() => setModalVisible(false)}>Cancel</Button>
              <Button type="primary" htmlType="submit">Save Connection</Button>
            </div>
          </Form>
        )}
      </Modal>
    </div>
  );
}

export default SettingsPage;
