import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Modal, Select, Switch, message, Spin, Card } from "antd";
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
  getConfigByType,
  setConfigByType,
  deleteConfigByType,
  testConfigByType,
  getProviderTypes,
  fetchOllamaModels,
  type ProviderConfig,
  type ProviderConfigInput,
  type ProviderType,
  type LLMProviderId,
  type OllamaModel,
  type ConfigType,
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
  const [llmConfig, setLlmConfig] = useState<ProviderConfig | null>(null);
  const [embeddingConfig, setEmbeddingConfig] = useState<ProviderConfig | null>(null);
  const [providerTypes, setProviderTypes] = useState<ProviderType[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingType, setEditingType] = useState<ConfigType | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderId | null>(null);
  const [testingType, setTestingType] = useState<ConfigType | null>(null);
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
      const [llm, embedding, types] = await Promise.all([
        getConfigByType("llm"),
        getConfigByType("embedding"),
        getProviderTypes(),
      ]);
      setLlmConfig(llm);
      setEmbeddingConfig(embedding);
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
   * Open modal to add/edit configuration
   */
  const handleOpenModal = (configType: ConfigType, existingConfig?: ProviderConfig | null) => {
    setEditingType(configType);
    form.resetFields();
    
    if (existingConfig) {
      setSelectedProvider(existingConfig.providerId);
      form.setFieldsValue({
        displayName: existingConfig.displayName,
        baseUrl: existingConfig.baseUrl,
        defaultModel: existingConfig.defaultModel,
        apiKey: "", // Don't fill in the API key
        enabled: existingConfig.enabled,
      });
      // Load Ollama models when editing Ollama provider
      if (existingConfig.providerId === "ollama" && existingConfig.baseUrl) {
        loadOllamaModels(existingConfig.baseUrl);
      }
    } else {
      setSelectedProvider(null);
    }
    setModalVisible(true);
  };

  /**
   * Delete a configuration
   */
  const handleDelete = async (configType: ConfigType, displayName: string) => {
    Modal.confirm({
      title: "删除配置",
      content: `确定要删除 "${displayName}" 吗？`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteConfigByType(configType);
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
  const handleTest = async (configType: ConfigType) => {
    setTestingType(configType);
    try {
      const result = await testConfigByType(configType);
      if (result.success) {
        message.success(`连接成功！`);
      } else {
        message.error(`连接失败`);
      }
      loadData(); // Refresh to update status
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "测试失败";
      message.error(errorMsg);
      loadData(); // Refresh to update status
    } finally {
      setTestingType(null);
    }
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async (values: Record<string, unknown>) => {
    if (!selectedProvider || !editingType) {
      message.error("请选择一个提供商类型");
      return;
    }

    const input: ProviderConfigInput = {
      providerId: selectedProvider,
      displayName: values.displayName as string,
      baseUrl: (values.baseUrl as string) || undefined,
      defaultModel: (values.defaultModel as string) || undefined,
      apiKey: (values.apiKey as string) || undefined,
      enabled: values.enabled as boolean ?? true,
    };

    setSubmitting(true);
    try {
      await setConfigByType(editingType, input);
      message.success("配置已保存");
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
  const handleSelectProvider = (providerId: LLMProviderId) => {
    setSelectedProvider(providerId);
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
   * Render a provider config card
   */
  const renderConfigCard = (configType: ConfigType, config: ProviderConfig | null, title: string, description: string) => {
    const isConfigured = !!config;
    const typeInfo = config ? getTypeInfo(config.providerId) : null;

    return (
      <Card 
        className="provider-section-card"
        title={
          <div className="provider-section-header">
            <span>{title}</span>
            <span className="provider-section-desc">{description}</span>
          </div>
        }
        extra={
          isConfigured ? (
            <div className="provider-card-actions">
              <Button
                icon={<ThunderboltOutlined />}
                loading={testingType === configType}
                onClick={() => handleTest(configType)}
                title="测试连接"
                size="small"
              />
              <Button 
                icon={<EditOutlined />} 
                onClick={() => handleOpenModal(configType, config)} 
                title="编辑"
                size="small"
              />
              <Button
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(configType, config.displayName)}
                title="删除"
                size="small"
              />
            </div>
          ) : (
            <Button 
              type="primary" 
              icon={<PlusOutlined />} 
              onClick={() => handleOpenModal(configType)}
              size="small"
            >
              配置
            </Button>
          )
        }
      >
        {isConfigured ? (
          <div className="provider-config-info">
            <div className="provider-config-row">
              <span className="provider-config-icon">{getProviderIcon(config.providerId)}</span>
              <span className="provider-config-name">{config.displayName}</span>
              <span className="provider-config-type">{typeInfo?.name || config.providerId}</span>
            </div>
            <div className="provider-config-details">
              <div className="provider-card-status">
                <span className={`provider-card-status-dot ${config.status}`} />
                <span>{config.status === "active" ? "正常" : config.status === "error" ? "错误" : "未测试"}</span>
              </div>
              {config.defaultModel && <span className="provider-config-model">模型：{config.defaultModel}</span>}
              {config.apiKeyMasked && <span className="provider-config-key">密钥：{config.apiKeyMasked}</span>}
              {!config.enabled && <span className="provider-disabled-tag">已禁用</span>}
            </div>
            {config.lastError && (
              <div className="provider-error-msg">
                错误：{config.lastError}
              </div>
            )}
          </div>
        ) : (
          <div className="provider-empty-hint">
            尚未配置，点击右上角按钮添加
          </div>
        )}
      </Card>
    );
  };

  /**
   * Render the selected provider type's configuration form
   */
  const renderForm = () => {
    if (!selectedProvider) return null;

    const typeInfo = getTypeInfo(selectedProvider);
    const existingConfig = editingType === "llm" ? llmConfig : embeddingConfig;
    const isEditing = !!existingConfig;
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
                if (selectedProvider === "ollama" && e.target.value) {
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
              {selectedProvider === "ollama" && (
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
          extra={selectedProvider === "ollama" ? "从 Ollama 服务获取已安装的模型" : "可选，用于测试连接和作为回退模型"}
        >
          {selectedProvider === "ollama" ? (
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
            保存
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

  const existingConfig = editingType === "llm" ? llmConfig : embeddingConfig;

  return (
    <>
      <div className="settings-content-header">
        <h2 className="settings-content-title">AI 提供商</h2>
      </div>

      <div className="provider-sections">
        {renderConfigCard(
          "llm",
          llmConfig,
          "大语言模型 (LLM)",
          "用于对话、内容生成等功能"
        )}
        {renderConfigCard(
          "embedding",
          embeddingConfig,
          "Embedding 模型",
          "用于知识库向量检索"
        )}
      </div>

      <Modal
        title={existingConfig ? "编辑提供商" : "添加提供商"}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        width={500}
        destroyOnClose
      >
        {!selectedProvider && !existingConfig ? (
          <>
            <p className="provider-type-hint">
              选择一个提供商类型：
            </p>
            <div className="provider-type-grid">
              {providerTypes.map((type) => (
                <div
                  key={type.id}
                  className={`provider-type-card${selectedProvider === type.id ? " selected" : ""}`}
                  onClick={() => handleSelectProvider(type.id)}
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
