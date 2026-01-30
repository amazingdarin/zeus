import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { FileTextOutlined } from "@ant-design/icons";

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
  { label: "Document", to: "/documents", icon: <FileTextOutlined /> },
];

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelRuntimes, setModelRuntimes] = useState<ModelRuntime[]>([]);
  const [modelSettingsLoading, setModelSettingsLoading] = useState(false);
  const [modelSettingsError, setModelSettingsError] = useState<string | null>(null);

  const activeIndex = useMemo(() => {
    const path = location.pathname;
    const index = navItems.findIndex((item) => item.to && path.startsWith(item.to));
    return index === -1 ? -1 : index;
  }, [location.pathname]);

  const settingsActive = useMemo(() => {
    return location.pathname.startsWith("/settings");
  }, [location.pathname]);

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
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo">Zeus</div>
        <div className="topbar-actions">
          <TopBarModelButton onOpen={() => setModelSettingsOpen(true)} />
        </div>
      </header>
      <div className="app-body compact">
        <Sidebar
          items={navItems}
          activeIndex={activeIndex}
          settingsActive={settingsActive}
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
