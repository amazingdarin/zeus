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
  DesktopOutlined,
  SyncOutlined,
} from "@ant-design/icons";

import {
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig,
  testConfig,
  getProviderTypes,
  fetchOllamaModels,
  type ProviderConfig,
  type ProviderConfigInput,
  type ProviderType,
  type LLMProviderId,
  type OllamaModel,
} from "../api/llm-config";

/**
 * Format file size
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

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
    case "ollama":
      return <DesktopOutlined />;
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
  const [submitting, setSubmitting] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
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
      message.error("加载配置失败");
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
    // Load Ollama models when editing Ollama provider
    if (config.providerId === "ollama" && config.baseUrl) {
      loadOllamaModels(config.baseUrl);
    }
  };

  /**
   * Delete a configuration
   */
  const handleDelete = async (config: ProviderConfig) => {
    Modal.confirm({
      title: "删除提供商配置",
      content: `确定要删除 "${config.displayName}" 吗？`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteConfig(config.id);
          message.success("配置已删除");
          loadData();
        } catch (err) {
          message.error("删除配置失败");
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
        message.success(`连接成功！测试模型：${result.model}`);
      }
      loadData(); // Refresh to update status
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "测试失败";
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
      message.error("请选择一个提供商类型");
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

    setSubmitting(true);
    try {
      if (editingConfig) {
        await updateConfig(editingConfig.id, input);
        message.success("配置已更新");
      } else {
        await createConfig(input);
        message.success("配置已创建");
      }
      setModalVisible(false);
      loadData();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "保存失败";
      message.error(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Get provider type info by ID
   */
  const getTypeInfo = (providerId: LLMProviderId) => {
    return providerTypes.find((t) => t.id === providerId);
  };

  /**
   * Load Ollama models from the API
   */
  const loadOllamaModels = useCallback(async (baseUrl: string) => {
    setLoadingOllamaModels(true);
    try {
      const models = await fetchOllamaModels(baseUrl);
      setOllamaModels(models);
      if (models.length > 0) {
        message.success(`已加载 ${models.length} 个模型`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "加载模型失败";
      message.error(errorMsg);
      setOllamaModels([]);
    } finally {
      setLoadingOllamaModels(false);
    }
  }, []);

  /**
   * Handle provider type selection
   */
  const handleSelectType = (providerId: LLMProviderId) => {
    setSelectedType(providerId);
    const typeInfo = providerTypes.find((t) => t.id === providerId);
    // Pre-fill default values
    if (typeInfo?.defaultBaseUrl) {
      form.setFieldValue("baseUrl", typeInfo.defaultBaseUrl);
      // Auto-load Ollama models
      if (providerId === "ollama") {
        loadOllamaModels(typeInfo.defaultBaseUrl);
      }
    }
  };

  /**
   * Render the selected provider type's configuration form
   */
  const renderForm = () => {
    if (!selectedType) return null;

    const typeInfo = getTypeInfo(selectedType);
    const isEditing = !!editingConfig;
    const requiresApiKey = typeInfo?.requiresApiKey ?? true;

    return (
      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="displayName"
          label="显示名称"
          rules={[{ required: true, message: "请输入显示名称" }]}
        >
          <Input placeholder={`我的 ${typeInfo?.name || ""} 连接`} />
        </Form.Item>

        {requiresApiKey && (
          <Form.Item
            name="apiKey"
            label="API 密钥"
            extra={isEditing ? "留空则保持现有密钥不变" : undefined}
            rules={[{ required: !isEditing, message: "API 密钥为必填项" }]}
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
        )}

        {typeInfo?.supportsBaseUrl && (
          <Form.Item
            name="baseUrl"
            label="API 地址"
            extra={typeInfo.requiresBaseUrl ? "该提供商必须填写此项" : "可选，用于自定义接口地址"}
            rules={typeInfo.requiresBaseUrl ? [{ required: true, message: "API 地址为必填项" }] : undefined}
          >
            <Input 
              placeholder={typeInfo.defaultBaseUrl || "https://api.example.com/v1"}
              onBlur={(e) => {
                // Auto-refresh Ollama models when baseUrl changes
                if (selectedType === "ollama" && e.target.value) {
                  loadOllamaModels(e.target.value);
                }
              }}
            />
          </Form.Item>
        )}

        <Form.Item
          name="defaultModel"
          label={
            <span>
              默认模型
              {selectedType === "ollama" && (
                <Button
                  type="link"
                  size="small"
                  icon={<SyncOutlined spin={loadingOllamaModels} />}
                  onClick={() => {
                    const baseUrl = form.getFieldValue("baseUrl") || typeInfo?.defaultBaseUrl;
                    if (baseUrl) loadOllamaModels(baseUrl);
                  }}
                  style={{ marginLeft: 8, padding: 0 }}
                >
                  刷新
                </Button>
              )}
            </span>
          }
          extra={selectedType === "ollama" ? "从 Ollama 服务获取已安装的模型" : "可选，用于测试连接和作为回退模型"}
        >
          {selectedType === "ollama" ? (
            <Select
              placeholder={loadingOllamaModels ? "正在加载模型..." : "选择一个模型"}
              allowClear
              showSearch
              loading={loadingOllamaModels}
              options={ollamaModels.map((m) => ({ 
                label: `${m.id} (${formatSize(m.size)})`, 
                value: m.id 
              }))}
              notFoundContent={loadingOllamaModels ? <Spin size="small" /> : "未找到模型，请确保 Ollama 正在运行"}
            />
          ) : typeInfo?.defaultModels && typeInfo.defaultModels.length > 0 ? (
            <Select
              placeholder="选择一个模型"
              allowClear
              showSearch
              options={typeInfo.defaultModels.map((m) => ({ label: m, value: m }))}
            />
          ) : (
            <Input placeholder="model-name" />
          )}
        </Form.Item>

        <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
          <Switch />
        </Form.Item>

        <div className="provider-form-actions">
          <Button onClick={() => setModalVisible(false)}>取消</Button>
          <Button type="primary" htmlType="submit" loading={submitting}>
            {isEditing ? "更新" : "创建"}
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
        <h2 className="settings-content-title">AI 提供商</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          添加提供商
        </Button>
      </div>

      {configs.length === 0 ? (
        <div className="provider-empty">
          <RobotOutlined className="provider-empty-icon" />
          <p className="provider-empty-text">尚未配置任何 AI 提供商</p>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            添加第一个提供商
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
                    <span>{config.status === "active" ? "正常" : config.status === "error" ? "错误" : "未知"}</span>
                  </div>
                  {config.defaultModel && <span>模型：{config.defaultModel}</span>}
                  {config.apiKeyMasked && <span>密钥：{config.apiKeyMasked}</span>}
                  {!config.enabled && <span className="provider-disabled-tag">已禁用</span>}
                </div>
                {config.lastError && (
                  <div className="provider-error-msg">
                    错误：{config.lastError}
                  </div>
                )}
              </div>
              <div className="provider-card-actions">
                <Button
                  icon={<ThunderboltOutlined />}
                  loading={testingId === config.id}
                  onClick={() => handleTest(config)}
                  title="测试连接"
                />
                <Button icon={<EditOutlined />} onClick={() => handleEdit(config)} title="编辑" />
                <Button
                  icon={<DeleteOutlined />}
                  onClick={() => handleDelete(config)}
                  title="删除"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={editingConfig ? "编辑提供商" : "添加提供商"}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={500}
        destroyOnClose
      >
        {!selectedType && !editingConfig ? (
          <>
            <p className="provider-type-hint">
              选择一个提供商类型：
            </p>
            <div className="provider-type-grid">
              {providerTypes.map((type) => (
                <div
                  key={type.id}
                  className={`provider-type-card${selectedType === type.id ? " selected" : ""}`}
                  onClick={() => handleSelectType(type.id)}
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
