import { useMemo, useState } from "react";
import { Alert, Button, Form, Input, Select, Spin, Switch } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

export type ScenarioKey = "chat" | "embedding" | "multimodal";

export type ScenarioDraft = {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  parametersText: string;
  isActive: boolean;
};

type ModelScenarioConfigPanelProps = {
  scenario: ScenarioKey;
  title: string;
  draft: ScenarioDraft;
  disabled?: boolean;
  onChange: (patch: Partial<ScenarioDraft>) => void;
  onRefreshModels: (baseUrl: string, apiKey: string) => Promise<string[]>;
};

function ModelScenarioConfigPanel({
  scenario,
  title,
  draft,
  disabled,
  onChange,
  onRefreshModels,
}: ModelScenarioConfigPanelProps) {
  const [models, setModels] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modelOptions = useMemo(() => {
    const unique = new Set(models);
    const list = [...models];
    if (draft.modelName && !unique.has(draft.modelName)) {
      list.unshift(draft.modelName);
    }
    return list;
  }, [models, draft.modelName]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const items = await onRefreshModels(draft.baseUrl, draft.apiKey);
      setModels(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "刷新模型列表失败";
      setError(message);
      setModels([]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="model-panel">
      <div className="model-panel-header">
        <h3>{title}</h3>
        {disabled ? <span className="model-pill">即将推出</span> : null}
      </div>
      <Form layout="vertical" disabled={disabled}>
        <Form.Item label="显示名称">
          <Input
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="运行时名称"
          />
        </Form.Item>
        <Form.Item label="接口地址">
          <Input
            value={draft.baseUrl}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
            placeholder="https://api.openai.com"
          />
        </Form.Item>
        <Form.Item label="API 密钥">
          <Input.Password
            value={draft.apiKey}
            onChange={(event) => onChange({ apiKey: event.target.value })}
            placeholder="可选"
          />
        </Form.Item>
        <Form.Item label="模型名称">
          <Input.Group compact>
            <Select
              className="model-select"
              value={draft.modelName || undefined}
              placeholder="选择模型"
              style={{ width: "calc(100% - 40px)" }}
              onChange={(value) => onChange({ modelName: value })}
              options={modelOptions.map((model) => ({ label: model, value: model }))}
              showSearch
              optionFilterProp="label"
            />
            <Button
              icon={refreshing ? <Spin size="small" /> : <ReloadOutlined />}
              aria-label="刷新模型列表"
              title="刷新模型列表"
              onClick={handleRefresh}
              disabled={disabled || refreshing}
            />
          </Input.Group>
        </Form.Item>
        {refreshing ? <div className="model-hint">正在刷新模型列表...</div> : null}
        <Form.Item label="参数">
          <Input.TextArea
            rows={6}
            value={draft.parametersText}
            onChange={(event) => onChange({ parametersText: event.target.value })}
            placeholder='{"temperature": 0.7}'
          />
        </Form.Item>
        {scenario === "embedding" ? (
          <div className="model-hint">Embedding 模型会忽略 temperature 参数。</div>
        ) : null}
        <Form.Item label="启用" style={{ marginBottom: 12 }}>
          <Switch
            checked={draft.isActive}
            onChange={(checked) => onChange({ isActive: checked })}
            disabled={disabled}
          />
        </Form.Item>
      </Form>
      {error ? <Alert type="error" message={error} showIcon /> : null}
    </div>
  );
}

export default ModelScenarioConfigPanel;
