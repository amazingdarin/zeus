import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Modal, Select, Switch, message, Spin } from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  CloudServerOutlined,
  ApiOutlined,
} from "@ant-design/icons";

import {
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig,
  testConfig,
  getProviderTypes,
  type ProviderConfig,
  type ProviderConfigInput,
  type ProviderType,
  type LLMProviderId,
} from "../api/llm-config";

/**
 * Get icon for provider type
 */
function getProviderIcon(providerId: LLMProviderId) {
  switch (providerId) {
    case "openai":
      return <RobotOutlined />;
    case "anthropic":
      return <CloudServerOutlined />;
    case "google":
      return <ApiOutlined />;
    default:
      return <CloudServerOutlined />;
  }
}

/**
 * AI Provider configuration panel
 */
function AIProviderPanel() {
  const [configs, setConfigs] = useState<ProviderConfig[]>([]);
  const [providerTypes, setProviderTypes] = useState<ProviderType[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ProviderConfig | null>(null);
  const [selectedType, setSelectedType] = useState<LLMProviderId | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form] = Form.useForm();

  /**
   * Load configurations and provider types
   */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [configList, types] = await Promise.all([listConfigs(), getProviderTypes()]);
      setConfigs(configList);
      setProviderTypes(types);
    } catch (err) {
      message.error("Failed to load provider configurations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /**
   * Open modal to add new configuration
   */
  const handleAdd = () => {
    setEditingConfig(null);
    setSelectedType(null);
    form.resetFields();
    setModalVisible(true);
  };

  /**
   * Open modal to edit existing configuration
   */
  const handleEdit = (config: ProviderConfig) => {
    setEditingConfig(config);
    setSelectedType(config.providerId);
    form.setFieldsValue({
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      defaultModel: config.defaultModel,
      apiKey: "", // Don't fill in the API key
      enabled: config.enabled,
    });
    setModalVisible(true);
  };

  /**
   * Delete a configuration
   */
  const handleDelete = async (config: ProviderConfig) => {
    Modal.confirm({
      title: "Delete Provider Configuration",
      content: `Are you sure you want to delete "${config.displayName}"?`,
      okText: "Delete",
      okType: "danger",
      cancelText: "Cancel",
      onOk: async () => {
        try {
          await deleteConfig(config.id);
          message.success("Configuration deleted");
          loadData();
        } catch (err) {
          message.error("Failed to delete configuration");
        }
      },
    });
  };

  /**
   * Test a configuration
   */
  const handleTest = async (config: ProviderConfig) => {
    setTestingId(config.id);
    try {
      const result = await testConfig(config.id);
      if (result.success) {
        message.success(`Connection successful! Tested with ${result.model}`);
      }
      loadData(); // Refresh to update status
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Test failed";
      message.error(errorMsg);
      loadData(); // Refresh to update status
    } finally {
      setTestingId(null);
    }
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!selectedType) {
      message.error("Please select a provider type");
      return;
    }

    const input: ProviderConfigInput = {
      providerId: selectedType,
      displayName: values.displayName as string,
      baseUrl: (values.baseUrl as string) || undefined,
      defaultModel: (values.defaultModel as string) || undefined,
      apiKey: (values.apiKey as string) || undefined,
      enabled: values.enabled as boolean ?? true,
    };

    try {
      if (editingConfig) {
        await updateConfig(editingConfig.id, input);
        message.success("Configuration updated");
      } else {
        await createConfig(input);
        message.success("Configuration created");
      }
      setModalVisible(false);
      loadData();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Save failed";
      message.error(errorMsg);
    }
  };

  /**
   * Get provider type info by ID
   */
  const getTypeInfo = (providerId: LLMProviderId) => {
    return providerTypes.find((t) => t.id === providerId);
  };

  /**
   * Render the selected provider type's configuration form
   */
  const renderForm = () => {
    if (!selectedType) return null;

    const typeInfo = getTypeInfo(selectedType);
    const isEditing = !!editingConfig;

    return (
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="displayName"
          label="Display Name"
          rules={[{ required: true, message: "Please enter a display name" }]}
        >
          <Input placeholder="My OpenAI Connection" />
        </Form.Item>

        <Form.Item
          name="apiKey"
          label="API Key"
          extra={isEditing ? "Leave blank to keep the existing API key" : undefined}
          rules={[{ required: !isEditing, message: "API Key is required" }]}
        >
          <Input.Password placeholder="sk-..." />
        </Form.Item>

        {typeInfo?.supportsBaseUrl && (
          <Form.Item
            name="baseUrl"
            label="Base URL"
            extra={typeInfo.requiresBaseUrl ? "Required for this provider" : "Optional, use custom endpoint"}
            rules={typeInfo.requiresBaseUrl ? [{ required: true, message: "Base URL is required" }] : undefined}
          >
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
        )}

        <Form.Item
          name="defaultModel"
          label="Default Model"
          extra="Optional, used for testing and as fallback"
        >
          {typeInfo?.defaultModels && typeInfo.defaultModels.length > 0 ? (
            <Select
              placeholder="Select a model"
              allowClear
              showSearch
              options={typeInfo.defaultModels.map((m) => ({ label: m, value: m }))}
            />
          ) : (
            <Input placeholder="model-name" />
          )}
        </Form.Item>

        <Form.Item name="enabled" label="Enabled" valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
          <Button onClick={() => setModalVisible(false)}>Cancel</Button>
          <Button type="primary" htmlType="submit">
            {isEditing ? "Update" : "Create"}
          </Button>
        </div>
      </Form>
    );
  };

  if (loading) {
    return (
      <div className="settings-empty">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      <div className="settings-content-header">
        <h2 className="settings-content-title">AI Providers</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          Add Provider
        </Button>
      </div>

      {configs.length === 0 ? (
        <div className="provider-empty">
          <RobotOutlined className="provider-empty-icon" />
          <p className="provider-empty-text">No AI providers configured yet</p>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            Add Your First Provider
          </Button>
        </div>
      ) : (
        <div className="provider-list">
          {configs.map((config) => (
            <div key={config.id} className="provider-card">
              <div className="provider-card-icon">{getProviderIcon(config.providerId)}</div>
              <div className="provider-card-content">
                <div className="provider-card-header">
                  <span className="provider-card-name">{config.displayName}</span>
                  <span className="provider-card-type">
                    {getTypeInfo(config.providerId)?.name || config.providerId}
                  </span>
                </div>
                <div className="provider-card-details">
                  <div className="provider-card-status">
                    <span className={`provider-card-status-dot ${config.status}`} />
                    <span>{config.status === "active" ? "Active" : config.status === "error" ? "Error" : "Unknown"}</span>
                  </div>
                  {config.defaultModel && <span>Model: {config.defaultModel}</span>}
                  {config.apiKeyMasked && <span>Key: {config.apiKeyMasked}</span>}
                  {!config.enabled && <span style={{ color: "#ef4444" }}>Disabled</span>}
                </div>
                {config.lastError && (
                  <div style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>
                    Error: {config.lastError}
                  </div>
                )}
              </div>
              <div className="provider-card-actions">
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={testingId === config.id}
                  onClick={() => handleTest(config)}
                  title="Test Connection"
                />
                <Button icon={<EditOutlined />} onClick={() => handleEdit(config)} title="Edit" />
                <Button
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(config)}
                  title="Delete"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={editingConfig ? "Edit Provider" : "Add Provider"}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={500}
        className="provider-modal"
        destroyOnClose
      >
        {!selectedType && !editingConfig ? (
          <>
            <p style={{ color: "rgba(255,255,255,0.6)", marginBottom: 16 }}>
              Select a provider type:
            </p>
            <div className="provider-type-grid">
              {providerTypes.map((type) => (
                <div
                  key={type.id}
                  className={`provider-type-card${selectedType === type.id ? " selected" : ""}`}
                  onClick={() => setSelectedType(type.id)}
                >
                  <div className="provider-type-card-icon">{getProviderIcon(type.id)}</div>
                  <div className="provider-type-card-name">{type.name}</div>
                  <div className="provider-type-card-desc">{type.description}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          renderForm()
        )}
      </Modal>
    </>
  );
}

export default AIProviderPanel;
