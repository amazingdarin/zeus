/**
 * WebSearchPanel - Web search configuration panel in settings
 */

import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Select, Switch, message, Card, Alert, Spin, Tag } from "antd";
import {
  GlobalOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  LinkOutlined,
  DeleteOutlined,
} from "@ant-design/icons";

import {
  getWebSearchConfig,
  setWebSearchConfig,
  deleteWebSearchConfig,
  testWebSearch,
  WEB_SEARCH_PROVIDERS,
  type WebSearchConfig,
  type WebSearchProvider,
} from "../api/web-search";

function WebSearchPanel() {
  const [config, setConfig] = useState<WebSearchConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [form] = Form.useForm();

  const selectedProvider = Form.useWatch("provider", form) as WebSearchProvider | undefined;
  const providerInfo = WEB_SEARCH_PROVIDERS.find((p) => p.id === selectedProvider);

  /**
   * Load configuration
   */
  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWebSearchConfig();
      setConfig(data);
      if (data) {
        form.setFieldsValue({
          provider: data.provider,
          apiKey: data.apiKeyMasked || "",
          enabled: data.enabled,
        });
      }
    } catch (err) {
      console.error("Failed to load web search config:", err);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  /**
   * Save configuration
   */
  const handleSave = async (values: {
    provider: WebSearchProvider;
    apiKey?: string;
    enabled: boolean;
  }) => {
    setSubmitting(true);
    setTestResult(null);
    try {
      const updated = await setWebSearchConfig({
        provider: values.provider,
        apiKey: values.apiKey,
        enabled: values.enabled,
      });
      setConfig(updated);
      message.success("配置已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Delete configuration
   */
  const handleDelete = async () => {
    setSubmitting(true);
    try {
      await deleteWebSearchConfig();
      setConfig(null);
      form.resetFields();
      message.success("配置已删除");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Test web search
   */
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const results = await testWebSearch("AI 人工智能最新进展");
      if (results.length > 0) {
        setTestResult({
          success: true,
          message: `测试成功！找到 ${results.length} 条结果: "${results[0].title}"`,
        });
      } else {
        setTestResult({
          success: false,
          message: "测试完成但没有返回结果",
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "测试失败",
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="web-search-panel-loading">
        <Spin size="large" />
        <p>加载配置中...</p>
      </div>
    );
  }

  return (
    <div className="web-search-panel">
      <div className="web-search-panel-header">
        <h3>
          <GlobalOutlined /> 网络搜索
        </h3>
        <p className="web-search-panel-desc">
          配置网络搜索 API 后，深度搜索模式将在知识库结果不足时自动搜索互联网获取最新信息。
        </p>
      </div>

      <Card className="web-search-panel-card">
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{
            provider: "tavily",
            enabled: true,
          }}
        >
          {/* Status indicator */}
          {config && (
            <div className="web-search-status">
              {config.enabled ? (
                <Tag icon={<CheckCircleOutlined />} color="success">
                  已启用
                </Tag>
              ) : (
                <Tag icon={<CloseCircleOutlined />} color="default">
                  已禁用
                </Tag>
              )}
              <span className="web-search-status-provider">
                当前: {WEB_SEARCH_PROVIDERS.find((p) => p.id === config.provider)?.name}
              </span>
            </div>
          )}

          {/* Provider selection */}
          <Form.Item
            name="provider"
            label="搜索提供商"
            rules={[{ required: true, message: "请选择搜索提供商" }]}
          >
            <Select
              placeholder="选择搜索提供商"
              options={WEB_SEARCH_PROVIDERS.map((p) => ({
                value: p.id,
                label: (
                  <div className="web-search-provider-option">
                    <span className="web-search-provider-name">{p.name}</span>
                    <span className="web-search-provider-desc">{p.description}</span>
                  </div>
                ),
              }))}
            />
          </Form.Item>

          {/* Provider info */}
          {providerInfo && (
            <Alert
              type="info"
              showIcon
              icon={<ExclamationCircleOutlined />}
              message={
                <div className="web-search-provider-info">
                  <span>{providerInfo.description}</span>
                  <a
                    href={providerInfo.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="web-search-provider-link"
                  >
                    <LinkOutlined /> 获取 API Key
                  </a>
                </div>
              }
              style={{ marginBottom: 16 }}
            />
          )}

          {/* API Key (if required) */}
          {providerInfo?.requiresApiKey && (
            <Form.Item
              name="apiKey"
              label="API Key"
              rules={[
                {
                  required: !config, // Only required for new config
                  message: "请输入 API Key",
                },
              ]}
            >
              <Input.Password
                placeholder={config ? "留空保持原密钥不变" : "输入 API Key"}
                autoComplete="off"
              />
            </Form.Item>
          )}

          {/* Enable switch */}
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>

          {/* Test result */}
          {testResult && (
            <Alert
              type={testResult.success ? "success" : "error"}
              message={testResult.message}
              showIcon
              style={{ marginBottom: 16 }}
              closable
              onClose={() => setTestResult(null)}
            />
          )}

          {/* Actions */}
          <div className="web-search-actions">
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={testing}
            >
              保存配置
            </Button>

            {config && (
              <>
                <Button
                  icon={<SearchOutlined />}
                  onClick={handleTest}
                  loading={testing}
                  disabled={submitting || !config.enabled}
                >
                  测试搜索
                </Button>
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={handleDelete}
                  disabled={submitting || testing}
                >
                  删除配置
                </Button>
              </>
            )}
          </div>
        </Form>
      </Card>

      {/* Usage hint */}
      <div className="web-search-hint">
        <h4>如何使用深度搜索</h4>
        <ol>
          <li>在上方配置并启用网络搜索 API</li>
          <li>在对话输入框旁点击 <SearchOutlined /> 按钮开启深度搜索模式</li>
          <li>输入问题后，系统会自动分解问题、搜索知识库，不足时搜索网络</li>
          <li>最终整合所有结果生成完整回答</li>
        </ol>
      </div>
    </div>
  );
}

export default WebSearchPanel;
