import { useEffect, useMemo, useState } from "react";

import type { ModelRuntime, ModelRuntimeInput } from "../api/model";
import ModelScenarioConfigPanel, {
  type ScenarioDraft,
  type ScenarioKey,
} from "./ModelScenarioConfigPanel";

const scenarioOrder: ScenarioKey[] = ["chat", "embedding", "multimodal"];

const scenarioTitles: Record<ScenarioKey, string> = {
  chat: "LLM Models",
  embedding: "Embedding Models",
  multimodal: "Multimodal Models",
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
      return "Chat";
    case "embedding":
      return "Embedding";
    case "multimodal":
      return "Multimodal";
    default:
      return "Runtime";
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
      throw new Error("Parameters must be a JSON object");
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
            isActive: true,
          }),
        );
      });
      await Promise.all(tasks);
      await onReload();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
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
      setTestStatus("Connection successful");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Test failed";
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
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="modal-card model-settings-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Model Settings</h2>
          <button className="modal-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {displayError ? <div className="modal-error">{displayError}</div> : null}
        {loading ? <div className="model-loading">Loading configurations...</div> : null}
        <div className="model-tabs">
          {scenarioOrder.map((scenario) => {
            const disabled = scenario === "multimodal";
            const active = activeTab === scenario;
            return (
              <button
                key={scenario}
                className={`model-tab${active ? " active" : ""}${disabled ? " disabled" : ""}`}
                type="button"
                onClick={() => !disabled && setActiveTab(scenario)}
                disabled={disabled}
              >
                {scenarioTitles[scenario]}
              </button>
            );
          })}
        </div>
        <div className="model-tab-panel">
          {activeTab === "chat" ? (
            <ModelScenarioConfigPanel
              scenario="chat"
              title="LLM Models"
              draft={drafts.chat}
              onChange={(patch) => handleChange("chat", patch)}
              onRefreshModels={onRefreshModels}
            />
          ) : null}
          {activeTab === "embedding" ? (
            <ModelScenarioConfigPanel
              scenario="embedding"
              title="Embedding Models"
              draft={drafts.embedding}
              onChange={(patch) => handleChange("embedding", patch)}
              onRefreshModels={onRefreshModels}
            />
          ) : null}
          {activeTab === "multimodal" ? (
            <ModelScenarioConfigPanel
              scenario="multimodal"
              title="Multimodal Models"
              draft={drafts.multimodal}
              onChange={(patch) => handleChange("multimodal", patch)}
              onRefreshModels={onRefreshModels}
              disabled
            />
          ) : null}
        </div>
        {testStatus ? <div className="model-success">{testStatus}</div> : null}
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={handleTest}
            disabled={testDisabled}
          >
            {testing ? "Testing..." : "Test"}
          </button>
          <button className="btn primary" type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ModelSettingsModal;
