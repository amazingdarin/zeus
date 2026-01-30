import { useCallback, useEffect, useRef, useState } from "react";
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
  Badge,
} from "antd";
import {
  PlusOutlined,
  CloudServerOutlined,
  SafetyCertificateOutlined,
  EditOutlined,
  ThunderboltOutlined,
  StopOutlined,
} from "@ant-design/icons";

import {
  fetchProviders,
  fetchConnections,
  upsertConnection,
  startDeviceAuth,
  pollDeviceAuth,
  storeApiKey,
  fetchConnectionModels,
  testProvider,
  type ProviderDefinition,
  type ProviderConnection,
} from "../api/provider";

const { Title, Text, Paragraph } = Typography;

function SettingsPage() {
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ProviderConnection | null>(null);
  
  const [authStep, setAuthStep] = useState<"select" | "input" | "device">("select");
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [deviceCodeData, setDeviceCodeData] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
    expiresAt?: string;
  } | null>(null);
  const [authCredentialId, setAuthCredentialId] = useState<string | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const [form] = Form.useForm();

  const [connectionModels, setConnectionModels] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({});

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

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [loadData]);

  const loadConnectionModels = async (connectionId: string) => {
    if (connectionModels[connectionId] || loadingModels[connectionId]) {
      return;
    }

    setLoadingModels((prev) => ({ ...prev, [connectionId]: true }));
    setModelErrors((prev) => ({ ...prev, [connectionId]: "" }));

    try {
      const models = await fetchConnectionModels(connectionId);
      setConnectionModels((prev) => ({ ...prev, [connectionId]: models }));
    } catch (err) {
      setModelErrors((prev) => ({ ...prev, [connectionId]: "Failed to load models" }));
      message.error("Failed to load models for connection");
    } finally {
      setLoadingModels((prev) => ({ ...prev, [connectionId]: false }));
    }
  };

  const handleModelChange = async (connectionId: string, modelName: string | undefined) => {
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) {
      return;
    }

    try {
      await upsertConnection({
        id: connection.id,
        providerId: connection.providerId,
        displayName: connection.displayName,
        modelName: modelName || undefined,
        baseUrl: connection.baseUrl,
        credentialId: connection.credentialId,
      });
      message.success("Model updated successfully");
      loadData();
    } catch (err) {
      message.error("Failed to update model");
    }
  };

  const handleTestConnection = async (connectionId: string) => {
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection?.modelName) {
      message.warning("Please select a model before testing the connection");
      return;
    }

    try {
      message.loading("Testing connection...", 0);
      await testProvider(connectionId, "chat");
      message.destroy();
      message.success("Connection test successful");
      loadData();
    } catch (err) {
      message.destroy();
      message.error("Connection test failed");
    }
  };


  const handleAddConnection = () => {
    setEditingConnection(null);
    setAuthStep("select");
    setSelectedProviderId("");
    setDeviceCodeData(null);
    setAuthCredentialId(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleCancelDeviceAuth = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setAuthStep("select");
    setDeviceCodeData(null);
    setAuthCredentialId(null);
  };

  const handleDeviceContinue = async () => {
    if (!authCredentialId) {
      message.error("Device authentication not completed");
      return;
    }
    try {
      await upsertConnection({
        providerId: selectedProviderId,
        displayName: "",
        modelName: undefined,
        baseUrl: undefined,
        credentialId: authCredentialId,
      });
      message.success("Connection created. You can set a default model in the list.");
      setModalVisible(false);
      handleCancelDeviceAuth();
      loadData();
    } catch (err) {
      message.error("Failed to create connection");
    }
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

    if (provider.authType === "device") {
      setAuthStep("device");
      initiateDeviceAuth(providerId);
    } else {
      setAuthStep("input");
    }
  };

  const initiateDeviceAuth = async (providerId: string) => {
    try {
      const data = await startDeviceAuth(providerId);
      setDeviceCodeData({
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        deviceCode: data.deviceCode,
        interval: data.interval,
        expiresAt: data.expiresAt,
      });

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

        const baseInterval = Math.max(1, data.interval) * 1000
        let currentInterval = baseInterval

        const schedulePoll = () => {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current)
          }

          pollingIntervalRef.current = setInterval(async () => {
            try {
              const result = await pollDeviceAuth(providerId, data.deviceCode)
              if (result.credentialId) {
                if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current)
                  pollingIntervalRef.current = null
                }
                setAuthCredentialId(result.credentialId)
                message.success("Device authentication successful! Click Continue to configure your connection.")
              }
            } catch (e: any) {
              const status = e?.status || e?.statusCode || e?.status_code
              if (status === "slow_down") {
                currentInterval = Math.min(currentInterval + baseInterval, 15000)
                schedulePoll()
                return
              }
              if (status && status !== "authorization_pending") {
                if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current)
                  pollingIntervalRef.current = null
                }
                message.error(e?.message || "Device authentication failed")
              }
            }
          }, currentInterval)
        }

        schedulePoll()

    } catch (err) {
      message.error("Failed to start device authentication");
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      let credentialId: string;

      if (editingConnection) {
        credentialId = editingConnection.credentialId;
        const apiKey = values.apiKey;

        if (selectedProvider?.authType === "api" && apiKey) {
          const result = await storeApiKey(selectedProviderId, apiKey);
          credentialId = result.credentialId;
        }
      } else if (selectedProvider?.authType === "device") {
        if (!authCredentialId) {
          message.error("Please complete device authentication first");
          return;
        }
        credentialId = authCredentialId;
      } else if (selectedProvider?.authType === "api") {
        if (!values.apiKey) {
          message.error("API Key is required for new connections");
          return;
        }
        const result = await storeApiKey(selectedProviderId, values.apiKey);
        credentialId = result.credentialId;
      } else {
        message.error("Unsupported provider authentication");
        return;
      }

      await upsertConnection({
        id: editingConnection?.id,
        providerId: selectedProviderId,
        displayName: values.displayName,
        modelName: values.modelName || undefined,
        baseUrl: values.baseUrl || undefined,
        credentialId,
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
                    <Button
                      key="test"
                      type="text"
                      icon={<ThunderboltOutlined />}
                      onClick={() => handleTestConnection(item.id)}
                      disabled={!item.modelName}
                    >
                      Test
                    </Button>,
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
                    <Space direction="vertical" size={4} style={{ width: "100%" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <Text type="secondary" style={{ fontSize: "12px" }}>Default Model:</Text>
                        <Select
                          style={{ width: "200px" }}
                          placeholder={loadingModels[item.id] ? "Loading..." : "Select a model"}
                          value={item.modelName}
                          loading={loadingModels[item.id]}
                          onChange={(value) => handleModelChange(item.id, value)}
                          onDropdownVisibleChange={(open) => {
                            if (open) {
                              loadConnectionModels(item.id);
                            }
                          }}
                          allowClear
                          showSearch
                          notFoundContent={modelErrors[item.id] ? (
                            <Text type="danger" style={{ fontSize: "12px" }}>{modelErrors[item.id]}</Text>
                          ) : loadingModels[item.id] ? (
                            <Text type="secondary" style={{ fontSize: "12px" }}>Loading models...</Text>
                          ) : (
                            <Text type="secondary" style={{ fontSize: "12px" }}>No models available</Text>
                          )}
                          options={(connectionModels[item.id] || []).map((model) => ({
                            label: model,
                            value: model,
                          }))}
                          popupRender={(menu) => (
                            <>
                              {menu}
                              <Button
                                type="link"
                                size="small"
                                style={{ padding: "4px 12px" }}
                                onClick={() => {
                                  const customModel = prompt("Enter custom model name:");
                                  if (customModel) {
                                    handleModelChange(item.id, customModel);
                                  }
                                }}
                              >
                                + Custom model
                              </Button>
                            </>
                          )}
                        />
                      </div>
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
          onCancel={() => {
            handleCancelDeviceAuth();
            setModalVisible(false);
          }}
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
                    <Tag>{item.authType}</Tag>
                  </Card>
                </List.Item>
              )}
            />
          )}


          {authStep === "device" && (
            <div style={{ textAlign: "center", padding: "24px" }}>
              {deviceCodeData && !authCredentialId ? (
                <>
                  <SafetyCertificateOutlined style={{ fontSize: "48px", color: "#52c41a", marginBottom: "16px" }} />
                  <Title level={4}>Device Authentication</Title>
                  <Paragraph>
                    Please visit <a href={deviceCodeData.verificationUri} target="_blank" rel="noopener noreferrer">{deviceCodeData.verificationUri}</a> and enter the code below:
                  </Paragraph>
                  <Title level={2} copyable>{deviceCodeData.userCode}</Title>
                  <Paragraph type="secondary">Waiting for authentication...</Paragraph>
                  <div style={{ marginTop: "24px", display: "flex", gap: "12px", justifyContent: "center" }}>
                    <Button danger icon={<StopOutlined />} onClick={handleCancelDeviceAuth}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : authCredentialId ? (
                <>
                  <SafetyCertificateOutlined style={{ fontSize: "48px", color: "#52c41a", marginBottom: "16px" }} />
                  <Title level={4}>Authentication Successful!</Title>
                  <Paragraph>Your device has been authenticated successfully.</Paragraph>
                  <Button type="primary" onClick={handleDeviceContinue}>
                    Continue
                  </Button>
                </>
              ) : null}
            </div>
          )}


        {authStep === "input" && (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
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
              extra="Optional - you can select a model after creating the connection"
            >
              <Input placeholder="gpt-4" />
            </Form.Item>

            <Form.Item name="baseUrl" label="Base URL">
              <Input placeholder="https://api.example.com/v1" />
            </Form.Item>

            {selectedProvider?.authType === "api" && (
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
