import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Modal, Segmented, Space, Spin } from "antd";

import type { ModelRuntime, ModelRuntimeInput } from "../api/model";
import ModelScenarioConfigPanel, {
  type ScenarioDraft,
  type ScenarioKey,
} from "./ModelScenarioConfigPanel";

const scenarioOrder: ScenarioKey[] = ["chat", "embedding", "multimodal"];

const scenarioTitles: Record<ScenarioKey, string> = {
  chat: "对话模型",
  embedding: "向量模型",
  multimodal: "多模态模型",
};

type ModelSettingsModalProps = {
  isOpen: boolean;
  loading: boolean;
  loadError: string | null;
  runtimes: ModelRuntime[];
  onClose: () => void;
  onReload: () => Promise<void>;
  onRefreshModels: (baseUrl: string, apiKey: string) => Promise<string[]>;
  onTestRuntime: (
    scenario: ScenarioKey,
    baseUrl: string,
    apiKey: string,
    modelName: string,
  ) => Promise<void>;
  onSaveRuntime: (input: ModelRuntimeInput) => Promise<ModelRuntime>;
};

const defaultScenarioName = (scenario: ScenarioKey) => {
  switch (scenario) {
    case "chat":
      return "对话";
    case "embedding":
      return "向量";
    case "multimodal":
      return "多模态";
    default:
      return "运行时";
  }
};

const buildDraft = (scenario: ScenarioKey, runtime?: ModelRuntime): ScenarioDraft => {
  const parameters = runtime?.parameters ?? {};
  return {
    name: runtime?.name ?? defaultScenarioName(scenario),
    baseUrl: runtime?.baseUrl ?? "",
    apiKey: "",
    modelName: runtime?.modelName ?? "",
    parametersText: Object.keys(parameters).length
      ? JSON.stringify(parameters, null, 2)
      : "",
    isActive: runtime?.isActive ?? true,
  };
};

function ModelSettingsModal({
  isOpen,
  loading,
  loadError,
  runtimes,
  onClose,
  onReload,
  onRefreshModels,
  onTestRuntime,
  onSaveRuntime,
}: ModelSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<ScenarioKey>("chat");
  const [drafts, setDrafts] = useState<Record<ScenarioKey, ScenarioDraft>>(() => ({
    chat: buildDraft("chat"),
    embedding: buildDraft("embedding"),
    multimodal: buildDraft("multimodal"),
  }));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const runtimeMap = useMemo(() => {
    const map = new Map<string, ModelRuntime>();
    runtimes.forEach((item) => {
      if (item?.scenario) {
        map.set(item.scenario, item);
      }
    });
    return map;
  }, [runtimes]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDrafts({
      chat: buildDraft("chat", runtimeMap.get("chat")),
      embedding: buildDraft("embedding", runtimeMap.get("embedding")),
      multimodal: buildDraft("multimodal", runtimeMap.get("multimodal")),
    });
  }, [isOpen, runtimeMap]);

  const handleChange = (scenario: ScenarioKey, patch: Partial<ScenarioDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [scenario]: { ...prev[scenario], ...patch },
    }));
  };

  const parseParameters = (scenario: ScenarioKey, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return {} as Record<string, unknown>;
    }
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("参数必须是 JSON 对象");
    }
    if (scenario === "embedding" && "temperature" in parsed) {
      const clone = { ...(parsed as Record<string, unknown>) };
      delete clone.temperature;
      return clone;
    }
    return parsed as Record<string, unknown>;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setTestStatus(null);
    setTestError(null);
    try {
      const tasks: Promise<ModelRuntime>[] = [];
      const enabledScenarios: ScenarioKey[] = ["chat", "embedding"];
      enabledScenarios.forEach((scenario) => {
        const draft = drafts[scenario];
        if (!draft.modelName) {
          return;
        }
        const parameters = parseParameters(scenario, draft.parametersText);
        tasks.push(
          onSaveRuntime({
            scenario,
            name: draft.name || defaultScenarioName(scenario),
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKey,
            modelName: draft.modelName,
            parameters,
            isActive: draft.isActive,
          }),
        );
      });
      await Promise.all(tasks);
      await onReload();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "保存失败";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const draft = drafts[activeTab];
    setTesting(true);
    setTestStatus(null);
    setTestError(null);
    try {
      await onTestRuntime(activeTab, draft.baseUrl, draft.apiKey, draft.modelName);
      setTestStatus("连接成功");
    } catch (err) {
      const message = err instanceof Error ? err.message : "测试失败";
      setTestError(message);
    } finally {
      setTesting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  const displayError = error || testError || loadError;
  const activeDraft = drafts[activeTab];
  const testDisabled =
    activeTab === "multimodal" || !activeDraft.modelName || saving || testing;

  return (
    <Modal
      open={isOpen}
      centered
      width={760}
      title="模型设置"
      onCancel={onClose}
      destroyOnHidden
      footer={(
        <Space>
          <Button onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={handleTest} disabled={testDisabled} loading={testing}>
            测试连接
          </Button>
          <Button type="primary" onClick={handleSave} loading={saving}>
            保存
          </Button>
        </Space>
      )}
    >
      {displayError ? (
        <Alert
          type="error"
          message={displayError}
          showIcon
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {testStatus ? (
        <Alert
          type="success"
          message={testStatus}
          showIcon
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {loading ? (
        <div className="model-loading">
          <Spin size="small" style={{ marginRight: 8 }} />
          加载配置中...
        </div>
      ) : null}
      <Segmented
        block
        style={{ marginBottom: 16 }}
        value={activeTab}
        onChange={(value) => setActiveTab(value as ScenarioKey)}
        options={scenarioOrder.map((scenario) => ({
          value: scenario,
          label: scenarioTitles[scenario],
          disabled: scenario === "multimodal",
        }))}
      />
      <div className="model-tab-panel">
        {activeTab === "chat" ? (
          <ModelScenarioConfigPanel
            scenario="chat"
            title="对话模型"
            draft={drafts.chat}
            onChange={(patch) => handleChange("chat", patch)}
            onRefreshModels={onRefreshModels}
          />
        ) : null}
        {activeTab === "embedding" ? (
          <ModelScenarioConfigPanel
            scenario="embedding"
            title="向量模型"
            draft={drafts.embedding}
            onChange={(patch) => handleChange("embedding", patch)}
            onRefreshModels={onRefreshModels}
          />
        ) : null}
        {activeTab === "multimodal" ? (
          <ModelScenarioConfigPanel
            scenario="multimodal"
            title="多模态模型"
            draft={drafts.multimodal}
            onChange={(patch) => handleChange("multimodal", patch)}
            onRefreshModels={onRefreshModels}
            disabled
          />
        ) : null}
      </div>
    </Modal>
  );
}

export default ModelSettingsModal;
