import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

import Sidebar from "../components/Sidebar";
import ModelSettingsModal from "../components/ModelSettingsModal";
import TopBarModelButton from "../components/TopBarModelButton";
import ChatDock from "../components/ChatDock";
import type { ModelRuntimeInput } from "../api/model";
import {
  fetchModelRuntimes,
  refreshRuntimeModels,
  testRuntime,
  upsertModelRuntime,
  type ModelRuntime,
} from "../api/model";

type AppShellProps = {
  children: ReactNode;
};

const navItems = [
  { label: "Knowledge Base", to: "/knowledge", icon: "K" },
];

function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelRuntimes, setModelRuntimes] = useState<ModelRuntime[]>([]);
  const [modelSettingsLoading, setModelSettingsLoading] = useState(false);
  const [modelSettingsError, setModelSettingsError] = useState<string | null>(null);
  const layoutStyle = useMemo(
    () => ({
      "--sidebar-width": collapsed ? "72px" : "240px",
    }),
    [collapsed],
  );

  const loadModelSettings = useCallback(async () => {
    setModelSettingsLoading(true);
    setModelSettingsError(null);
    try {
      const runtimes = await fetchModelRuntimes();
      setModelRuntimes(runtimes);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load model settings";
      setModelSettingsError(message);
    } finally {
      setModelSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!modelSettingsOpen) {
      return;
    }
    loadModelSettings();
  }, [modelSettingsOpen, loadModelSettings]);

  const handleRefreshModels = useCallback((baseUrl: string, apiKey: string): Promise<string[]> => {
    return refreshRuntimeModels(baseUrl, apiKey);
  }, []);

  const handleTestRuntime = useCallback(
    (scenario: "chat" | "embedding" | "multimodal", baseUrl: string, apiKey: string, modelName: string) => {
      return testRuntime(scenario, baseUrl, apiKey, modelName);
    },
    [],
  );

  const handleSaveRuntime = useCallback((input: ModelRuntimeInput) => {
    return upsertModelRuntime(input);
  }, []);

  return (
    <div className="app-shell" style={layoutStyle as CSSProperties}>
      <header className="topbar">
        <div className="topbar-logo">Zeus</div>
        <div className="topbar-actions">
          <TopBarModelButton onOpen={() => setModelSettingsOpen(true)} />
        </div>
      </header>
      <div className={`app-body${collapsed ? " compact" : ""}`}>
        <Sidebar
          items={navItems}
          activeIndex={0}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((prev) => !prev)}
        />
        <main className="content">{children}</main>
      </div>
      <ChatDock />
      <ModelSettingsModal
        isOpen={modelSettingsOpen}
        loading={modelSettingsLoading}
        loadError={modelSettingsError}
        runtimes={modelRuntimes}
        onClose={() => setModelSettingsOpen(false)}
        onReload={loadModelSettings}
        onRefreshModels={handleRefreshModels}
        onTestRuntime={handleTestRuntime}
        onSaveRuntime={handleSaveRuntime}
      />
    </div>
  );
}

export default AppShell;
