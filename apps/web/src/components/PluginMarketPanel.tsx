import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, Space, Spin, Switch, Tag, message } from "antd";
import { DeleteOutlined, DownloadOutlined, ReloadOutlined, SearchOutlined, SyncOutlined } from "@ant-design/icons";
import type { PluginStorePluginSummary } from "@zeus/plugin-sdk-shared";

import {
  installPlugin,
  listMyPlugins,
  listPluginStore,
  listPluginVersions,
  setPluginEnabled,
  uninstallPlugin,
  type InstalledPlugin,
} from "../api/plugins";
import { usePluginRuntime } from "../context/PluginRuntimeContext";

type PendingAction =
  | { type: "install"; pluginId: string }
  | { type: "toggle"; pluginId: string }
  | { type: "uninstall"; pluginId: string }
  | null;

function PluginMarketPanel() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storePlugins, setStorePlugins] = useState<PluginStorePluginSummary[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const { refresh: refreshPluginRuntime } = usePluginRuntime();

  const refreshData = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      const [store, installed] = await Promise.all([
        listPluginStore(query),
        listMyPlugins(),
      ]);
      setStorePlugins(store);
      setInstalledPlugins(installed);
      setActiveQuery(query);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "加载插件市场失败";
      setError(messageText);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshData("");
  }, [refreshData]);

  const installedById = useMemo(() => {
    const map = new Map<string, InstalledPlugin>();
    for (const item of installedPlugins) {
      map.set(item.installation.pluginId, item);
    }
    return map;
  }, [installedPlugins]);

  const installedOnly = useMemo(() => {
    const visible = new Set(storePlugins.map((item) => item.pluginId));
    return installedPlugins.filter((item) => !visible.has(item.installation.pluginId));
  }, [storePlugins, installedPlugins]);

  const runInstall = useCallback(async (plugin: PluginStorePluginSummary) => {
    setPendingAction({ type: "install", pluginId: plugin.pluginId });
    try {
      const versions = await listPluginVersions(plugin.pluginId);
      const targetVersion = String(versions[0]?.version || plugin.latestVersion || "").trim();
      if (!targetVersion) {
        throw new Error(`插件 ${plugin.pluginId} 没有可安装版本`);
      }
      await installPlugin(plugin.pluginId, targetVersion);
      message.success(`已安装 ${plugin.displayName}@${targetVersion}`);
      refreshPluginRuntime();
      await refreshData(activeQuery);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "插件安装失败";
      message.error(messageText);
    } finally {
      setPendingAction(null);
    }
  }, [activeQuery, refreshData, refreshPluginRuntime]);

  const runToggle = useCallback(async (pluginId: string, enabled: boolean) => {
    setPendingAction({ type: "toggle", pluginId });
    try {
      await setPluginEnabled(pluginId, enabled);
      message.success(enabled ? `已启用 ${pluginId}` : `已停用 ${pluginId}`);
      refreshPluginRuntime();
      await refreshData(activeQuery);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "更新插件状态失败";
      message.error(messageText);
    } finally {
      setPendingAction(null);
    }
  }, [activeQuery, refreshData, refreshPluginRuntime]);

  const runUninstall = useCallback(async (pluginId: string) => {
    setPendingAction({ type: "uninstall", pluginId });
    try {
      await uninstallPlugin(pluginId);
      message.success(`已卸载 ${pluginId}`);
      refreshPluginRuntime();
      await refreshData(activeQuery);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "插件卸载失败";
      message.error(messageText);
    } finally {
      setPendingAction(null);
    }
  }, [activeQuery, refreshData, refreshPluginRuntime]);

  const isActionPending = useCallback((type: "install" | "toggle" | "uninstall", pluginId: string): boolean => {
    if (!pendingAction) return false;
    return pendingAction.type === type && pendingAction.pluginId === pluginId;
  }, [pendingAction]);

  return (
    <div className="plugin-market-panel">
      <div className="plugin-market-header">
        <h3>插件市场</h3>
        <p className="plugin-market-desc">
          当前从本地目录扫描可安装插件（`data/plugins`）。
        </p>
      </div>

      <div className="plugin-market-toolbar">
        <Input
          value={queryInput}
          placeholder="按插件 ID / 名称搜索"
          allowClear
          onChange={(event) => setQueryInput(event.target.value)}
          onPressEnter={() => {
            void refreshData(queryInput.trim());
          }}
          prefix={<SearchOutlined />}
        />
        <Button
          icon={<SearchOutlined />}
          onClick={() => {
            void refreshData(queryInput.trim());
          }}
          loading={loading}
        >
          搜索
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            void refreshData(activeQuery);
          }}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 12 }}
        />
      )}

      {loading ? (
        <div className="plugin-market-loading">
          <Spin />
          <span>加载插件中...</span>
        </div>
      ) : (
        <>
          {storePlugins.length === 0 ? (
            <div className="plugin-market-empty">
              <Empty description="未发现可用插件" />
            </div>
          ) : (
            <div className="plugin-market-grid">
              {storePlugins.map((plugin) => {
                const installed = installedById.get(plugin.pluginId);
                const installedVersion = installed?.installation.version;
                const installedStatus = installed?.installation.status;
                const isInstalled = Boolean(installed && installedStatus !== "uninstalled");
                const isEnabled = installed?.installation.enabled === true;
                const hasUpgrade = Boolean(
                  isInstalled
                  && installedVersion
                  && plugin.latestVersion
                  && installedVersion !== plugin.latestVersion,
                );

                return (
                  <Card
                    key={plugin.pluginId}
                    className="plugin-market-card"
                    title={
                      <div className="plugin-market-card-title">
                        <span>{plugin.displayName}</span>
                        <Tag>{plugin.pluginId}</Tag>
                      </div>
                    }
                  >
                    <p className="plugin-market-card-desc">
                      {plugin.description || "暂无描述"}
                    </p>
                    <div className="plugin-market-meta">
                      <Tag color="blue">latest {plugin.latestVersion}</Tag>
                      <Tag>versions {plugin.versions.length}</Tag>
                      {isInstalled && (
                        <Tag color={isEnabled ? "green" : "default"}>
                          {isEnabled ? "已启用" : "已停用"}
                        </Tag>
                      )}
                    </div>
                    {Array.isArray(plugin.tags) && plugin.tags.length > 0 && (
                      <div className="plugin-market-tags">
                        {plugin.tags.map((tag) => (
                          <Tag key={`${plugin.pluginId}:${tag}`}>{tag}</Tag>
                        ))}
                      </div>
                    )}
                    <Space wrap>
                      {!isInstalled ? (
                        <Button
                          type="primary"
                          icon={<DownloadOutlined />}
                          loading={isActionPending("install", plugin.pluginId)}
                          onClick={() => {
                            void runInstall(plugin);
                          }}
                        >
                          安装
                        </Button>
                      ) : (
                        <>
                          <Switch
                            checked={isEnabled}
                            checkedChildren="启用"
                            unCheckedChildren="停用"
                            loading={isActionPending("toggle", plugin.pluginId)}
                            onChange={(checked) => {
                              void runToggle(plugin.pluginId, checked);
                            }}
                          />
                          {hasUpgrade && (
                            <Button
                              icon={<SyncOutlined />}
                              loading={isActionPending("install", plugin.pluginId)}
                              onClick={() => {
                                void runInstall(plugin);
                              }}
                            >
                              升级
                            </Button>
                          )}
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            loading={isActionPending("uninstall", plugin.pluginId)}
                            onClick={() => {
                              void runUninstall(plugin.pluginId);
                            }}
                          >
                            卸载
                          </Button>
                        </>
                      )}
                    </Space>
                  </Card>
                );
              })}
            </div>
          )}

          {installedOnly.length > 0 && (
            <div className="plugin-market-installed-only">
              <h4>已安装（未在当前市场结果中）</h4>
              <div className="plugin-market-grid">
                {installedOnly.map((item) => (
                  <Card
                    key={`installed-only:${item.installation.pluginId}`}
                    className="plugin-market-card"
                    title={
                      <div className="plugin-market-card-title">
                        <span>{item.manifest.displayName}</span>
                        <Tag>{item.installation.pluginId}</Tag>
                      </div>
                    }
                  >
                    <p className="plugin-market-card-desc">
                      {item.manifest.description || "暂无描述"}
                    </p>
                    <div className="plugin-market-meta">
                      <Tag color="blue">{item.installation.version}</Tag>
                      <Tag color={item.installation.enabled ? "green" : "default"}>
                        {item.installation.enabled ? "已启用" : "已停用"}
                      </Tag>
                    </div>
                    <Space wrap>
                      <Switch
                        checked={item.installation.enabled}
                        checkedChildren="启用"
                        unCheckedChildren="停用"
                        loading={isActionPending("toggle", item.installation.pluginId)}
                        onChange={(checked) => {
                          void runToggle(item.installation.pluginId, checked);
                        }}
                      />
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        loading={isActionPending("uninstall", item.installation.pluginId)}
                        onClick={() => {
                          void runUninstall(item.installation.pluginId);
                        }}
                      >
                        卸载
                      </Button>
                    </Space>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default PluginMarketPanel;
