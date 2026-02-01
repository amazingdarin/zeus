import { useMemo, useState } from "react";
import { Select } from "antd";

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
      <label className="model-field">
        <span>显示名称</span>
        <input
          type="text"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="运行时名称"
          disabled={disabled}
        />
      </label>
      <label className="model-field">
        <span>接口地址</span>
        <input
          type="text"
          value={draft.baseUrl}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
          placeholder="https://api.openai.com"
          disabled={disabled}
        />
      </label>
      <label className="model-field">
        <span>API 密钥</span>
        <input
          type="password"
          value={draft.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value })}
          placeholder="可选"
          disabled={disabled}
        />
      </label>
      <label className="model-field">
        <span>模型名称</span>
        <div className="model-input-row">
          <Select
            className="model-select"
            value={draft.modelName || undefined}
            placeholder="选择模型"
            disabled={disabled}
            onChange={(value) => onChange({ modelName: value })}
            options={modelOptions.map((model) => ({ label: model, value: model }))}
          />
          <button
            className="model-icon-button"
            type="button"
            onClick={handleRefresh}
            disabled={disabled || refreshing}
            aria-label="刷新模型列表"
            title="刷新模型列表"
          >
            {refreshing ? (
              <span className="model-refresh-spinner" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M20 6v6h-6M4 18v-6h6M19 12a7 7 0 0 0-12-4M5 12a7 7 0 0 0 12 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </label>
      {refreshing ? <div className="model-hint">正在刷新模型列表...</div> : null}
      <details className="model-params" open>
        <summary>参数</summary>
        <textarea
          value={draft.parametersText}
          onChange={(event) => onChange({ parametersText: event.target.value })}
          placeholder='{"temperature": 0.7}'
          disabled={disabled}
        />
        {scenario === "embedding" ? (
          <div className="model-hint">Embedding 模型会忽略 temperature 参数。</div>
        ) : null}
      </details>
      {error ? <div className="model-error">{error}</div> : null}
    </div>
  );
}

export default ModelScenarioConfigPanel;
