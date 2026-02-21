import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Empty, Input, InputNumber, Modal, Select, Space, Spin, Switch, Tag, message } from "antd";
import { DeleteOutlined, DownloadOutlined, ReloadOutlined, SearchOutlined, SettingOutlined, SyncOutlined } from "@ant-design/icons";
import type {
  PluginManifestV2,
  PluginSettingsField,
  PluginStorePluginSummary,
} from "@zeus/plugin-sdk-shared";

import {
  getPluginSettings,
  installPlugin,
  listMyPlugins,
  listPluginStore,
  listPluginVersions,
  setPluginSettings,
  setPluginEnabled,
  uninstallPlugin,
  type InstalledPlugin,
} from "../api/plugins";
import { usePluginRuntime } from "../context/PluginRuntimeContext";

type PendingAction =
  | { type: "install"; pluginId: string }
  | { type: "toggle"; pluginId: string }
  | { type: "uninstall"; pluginId: string }
  | { type: "save-settings"; pluginId: string }
  | null;

function hasPluginSettingsSchema(manifest: PluginManifestV2): boolean {
  return Array.isArray(manifest.settings?.fields) && manifest.settings.fields.length > 0;
}

function collectPluginSettingsDefaults(manifest: PluginManifestV2): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const field of manifest.settings?.fields || []) {
    if (field.default !== undefined) {
      defaults[field.key] = field.default;
    }
  }
  return defaults;
}

function buildPluginSettingsDraft(
  manifest: PluginManifestV2,
  source?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...collectPluginSettingsDefaults(manifest),
    ...(source || {}),
  };
}

function PluginMarketPanel() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storePlugins, setStorePlugins] = useState<PluginStorePluginSummary[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pluginSettingsDrafts, setPluginSettingsDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [loadingSettingsByPlugin, setLoadingSettingsByPlugin] = useState<Record<string, boolean>>({});
  const [settingsErrorByPlugin, setSettingsErrorByPlugin] = useState<Record<string, string | null>>({});
  const [configPluginId, setConfigPluginId] = useState<string | null>(null);
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

  const configPlugin = useMemo(() => {
    if (!configPluginId) return null;
    return installedById.get(configPluginId) || null;
  }, [configPluginId, installedById]);

  useEffect(() => {
    if (!configPluginId) return;
    if (!installedById.has(configPluginId)) {
      setConfigPluginId(null);
    }
  }, [configPluginId, installedById]);

  const loadPluginSettings = useCallback(async (plugin: InstalledPlugin, force = false) => {
    const pluginId = plugin.installation.pluginId;
    if (!force && pluginSettingsDrafts[pluginId]) {
      return;
    }

    setLoadingSettingsByPlugin((prev) => ({
      ...prev,
      [pluginId]: true,
    }));
    setSettingsErrorByPlugin((prev) => ({
      ...prev,
      [pluginId]: null,
    }));

    try {
      const settings = await getPluginSettings(pluginId);
      setPluginSettingsDrafts((prev) => ({
        ...prev,
        [pluginId]: buildPluginSettingsDraft(plugin.manifest, settings),
      }));
    } catch (err) {
      const text = err instanceof Error ? err.message : "加载插件配置失败";
      setSettingsErrorByPlugin((prev) => ({
        ...prev,
        [pluginId]: text,
      }));
      setPluginSettingsDrafts((prev) => ({
        ...prev,
        [pluginId]: buildPluginSettingsDraft(plugin.manifest, {}),
      }));
    } finally {
      setLoadingSettingsByPlugin((prev) => ({
        ...prev,
        [pluginId]: false,
      }));
    }
  }, [pluginSettingsDrafts]);

  const openConfigModal = useCallback((plugin: InstalledPlugin) => {
    if (!hasPluginSettingsSchema(plugin.manifest)) {
      message.info("该插件没有可配置项");
      return;
    }
    setConfigPluginId(plugin.installation.pluginId);
    void loadPluginSettings(plugin);
  }, [loadPluginSettings]);

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
      if (configPluginId === pluginId) {
        setConfigPluginId(null);
      }
      refreshPluginRuntime();
      await refreshData(activeQuery);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "插件卸载失败";
      message.error(messageText);
    } finally {
      setPendingAction(null);
    }
  }, [activeQuery, configPluginId, refreshData, refreshPluginRuntime]);

  const updatePluginSettingDraft = useCallback(
    (pluginId: string, key: string, value: unknown) => {
      setPluginSettingsDrafts((prev) => ({
        ...prev,
        [pluginId]: {
          ...(prev[pluginId] || {}),
          [key]: value,
        },
      }));
    },
    [],
  );

  const resetPluginSettingDraft = useCallback(
    (plugin: InstalledPlugin) => {
      setPluginSettingsDrafts((prev) => ({
        ...prev,
        [plugin.installation.pluginId]: buildPluginSettingsDraft(plugin.manifest, {}),
      }));
      setSettingsErrorByPlugin((prev) => ({
        ...prev,
        [plugin.installation.pluginId]: null,
      }));
    },
    [],
  );

  const runSaveSettings = useCallback(
    async (plugin: InstalledPlugin) => {
      const pluginId = plugin.installation.pluginId;
      const draft = pluginSettingsDrafts[pluginId] || buildPluginSettingsDraft(plugin.manifest, {});
      setPendingAction({ type: "save-settings", pluginId });
      try {
        const next = await setPluginSettings(pluginId, draft);
        setPluginSettingsDrafts((prev) => ({
          ...prev,
          [pluginId]: buildPluginSettingsDraft(plugin.manifest, next),
        }));
        setSettingsErrorByPlugin((prev) => ({
          ...prev,
          [pluginId]: null,
        }));
        message.success(`已保存 ${plugin.manifest.displayName} 设置`);
      } catch (err) {
        const text = err instanceof Error ? err.message : "保存插件配置失败";
        setSettingsErrorByPlugin((prev) => ({
          ...prev,
          [pluginId]: text,
        }));
        message.error(text);
      } finally {
        setPendingAction(null);
      }
    },
    [pluginSettingsDrafts],
  );

  const renderPluginSettingField = useCallback(
    (
      plugin: InstalledPlugin,
      field: PluginSettingsField,
      value: unknown,
    ) => {
      const pluginId = plugin.installation.pluginId;
      const fieldType = String(field.type || "string").trim();

      if (fieldType === "boolean") {
        return (
          <Switch
            checked={value === true}
            checkedChildren="开"
            unCheckedChildren="关"
            onChange={(checked) => {
              updatePluginSettingDraft(pluginId, field.key, checked);
            }}
          />
        );
      }

      if (fieldType === "number") {
        return (
          <InputNumber
            style={{ width: "100%" }}
            value={typeof value === "number" ? value : undefined}
            min={typeof field.min === "number" ? field.min : undefined}
            max={typeof field.max === "number" ? field.max : undefined}
            step={typeof field.step === "number" ? field.step : undefined}
            placeholder={field.placeholder || undefined}
            onChange={(next) => {
              if (typeof next === "number") {
                updatePluginSettingDraft(pluginId, field.key, next);
                return;
              }
              if (next === null) {
                updatePluginSettingDraft(pluginId, field.key, field.default);
              }
            }}
          />
        );
      }

      if (fieldType === "select") {
        return (
          <Select
            value={typeof value === "string" ? value : undefined}
            options={(field.options || []).map((option) => ({
              label: option.label,
              value: option.value,
            }))}
            onChange={(next) => {
              updatePluginSettingDraft(pluginId, field.key, next);
            }}
          />
        );
      }

      if (fieldType === "textarea") {
        return (
          <Input.TextArea
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder || undefined}
            autoSize={{ minRows: 2, maxRows: 6 }}
            onChange={(event) => {
              updatePluginSettingDraft(pluginId, field.key, event.target.value);
            }}
          />
        );
      }

      if (field.secret) {
        return (
          <Input.Password
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder || undefined}
            onChange={(event) => {
              updatePluginSettingDraft(pluginId, field.key, event.target.value);
            }}
          />
        );
      }

      return (
        <Input
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder || undefined}
          onChange={(event) => {
            updatePluginSettingDraft(pluginId, field.key, event.target.value);
          }}
        />
      );
    },
    [updatePluginSettingDraft],
  );

  const isActionPending = useCallback((type: "install" | "toggle" | "uninstall" | "save-settings", pluginId: string): boolean => {
    if (!pendingAction) return false;
    return pendingAction.type === type && pendingAction.pluginId === pluginId;
  }, [pendingAction]);

  const renderConfigModalContent = () => {
    if (!configPlugin) {
      return null;
    }

    const pluginId = configPlugin.installation.pluginId;
    const fields = configPlugin.manifest.settings?.fields || [];
    const draft = pluginSettingsDrafts[pluginId] || buildPluginSettingsDraft(configPlugin.manifest, {});
    const loadingSettings = loadingSettingsByPlugin[pluginId] === true;
    const settingsError = settingsErrorByPlugin[pluginId];

    return (
      <div className="plugin-market-settings">
        <div className="plugin-market-settings-header">
          <span className="plugin-market-settings-title">
            {configPlugin.manifest.settings?.title || "插件设置"}
          </span>
          <Tag color={configPlugin.installation.enabled ? "green" : "default"}>
            {configPlugin.installation.enabled ? "已启用" : "已停用"}
          </Tag>
        </div>
        {configPlugin.manifest.settings?.description && (
          <div className="plugin-market-settings-description">
            {configPlugin.manifest.settings.description}
          </div>
        )}
        {loadingSettings && (
          <div className="plugin-market-settings-loading">
            <Spin size="small" />
            <span>加载插件配置...</span>
          </div>
        )}
        {settingsError && (
          <Alert
            type="error"
            showIcon
            message={settingsError}
          />
        )}
        {!loadingSettings && (
          <>
            <div className="plugin-market-settings-fields">
              {fields.map((field) => (
                <div key={`${pluginId}:${field.key}`} className="plugin-market-settings-field">
                  <div className="plugin-market-settings-label">
                    {field.title}
                    {field.required && <span className="plugin-market-settings-required">*</span>}
                  </div>
                  {field.description && (
                    <div className="plugin-market-settings-help">
                      {field.description}
                    </div>
                  )}
                  {renderPluginSettingField(configPlugin, field, draft[field.key])}
                </div>
              ))}
            </div>
            <Space wrap>
              <Button
                size="small"
                onClick={() => {
                  resetPluginSettingDraft(configPlugin);
                }}
              >
                重置默认
              </Button>
            </Space>
          </>
        )}
      </div>
    );
  };

  return (
    <>
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
                          <span className="plugin-market-card-title-name">{plugin.displayName}</span>
                          <div className="plugin-market-card-title-right">
                            <Tag>{plugin.pluginId}</Tag>
                            {isInstalled && (
                              <Switch
                                checked={isEnabled}
                                checkedChildren="启用"
                                unCheckedChildren="停用"
                                loading={isActionPending("toggle", plugin.pluginId)}
                                onChange={(checked) => {
                                  void runToggle(plugin.pluginId, checked);
                                }}
                              />
                            )}
                          </div>
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
                      {!isInstalled ? (
                        <div className="plugin-market-install-row">
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
                        </div>
                      ) : (
                        <div className="plugin-market-actions">
                          <div className="plugin-market-button-row">
                            <Button
                              size="small"
                              icon={<SyncOutlined />}
                              loading={isActionPending("install", plugin.pluginId)}
                              onClick={() => {
                                void runInstall(plugin);
                              }}
                            >
                              {hasUpgrade ? "升级" : "重装"}
                            </Button>
                            {installed && hasPluginSettingsSchema(installed.manifest) && (
                              <Button
                                size="small"
                                icon={<SettingOutlined />}
                                onClick={() => {
                                  openConfigModal(installed);
                                }}
                              >
                                配置
                              </Button>
                            )}
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              loading={isActionPending("uninstall", plugin.pluginId)}
                              onClick={() => {
                                void runUninstall(plugin.pluginId);
                              }}
                            >
                              卸载
                            </Button>
                          </div>
                        </div>
                      )}
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
                        <span className="plugin-market-card-title-name">{item.manifest.displayName}</span>
                        <div className="plugin-market-card-title-right">
                          <Tag>{item.installation.pluginId}</Tag>
                          <Switch
                            checked={item.installation.enabled}
                            checkedChildren="启用"
                            unCheckedChildren="停用"
                            loading={isActionPending("toggle", item.installation.pluginId)}
                            onChange={(checked) => {
                              void runToggle(item.installation.pluginId, checked);
                            }}
                          />
                        </div>
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
                      <div className="plugin-market-actions">
                        <div className="plugin-market-button-row">
                          <Button
                            size="small"
                            icon={<SyncOutlined />}
                            loading={isActionPending("install", item.installation.pluginId)}
                            onClick={() => {
                              void runInstall({
                                pluginId: item.installation.pluginId,
                                displayName: item.manifest.displayName,
                                description: item.manifest.description,
                                latestVersion: item.installation.version,
                                versions: [item.installation.version],
                                tags: [],
                              });
                            }}
                          >
                            重装
                          </Button>
                          {hasPluginSettingsSchema(item.manifest) && (
                            <Button
                              size="small"
                              icon={<SettingOutlined />}
                              onClick={() => {
                                openConfigModal(item);
                              }}
                            >
                              配置
                            </Button>
                          )}
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            loading={isActionPending("uninstall", item.installation.pluginId)}
                            onClick={() => {
                              void runUninstall(item.installation.pluginId);
                            }}
                          >
                            卸载
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        open={Boolean(configPlugin)}
        title={configPlugin ? `${configPlugin.manifest.displayName} 配置` : "插件配置"}
        onCancel={() => setConfigPluginId(null)}
        onOk={() => {
          if (!configPlugin) return;
          void runSaveSettings(configPlugin);
        }}
        okText="保存设置"
        cancelText="关闭"
        okButtonProps={{
          loading: configPlugin ? isActionPending("save-settings", configPlugin.installation.pluginId) : false,
          disabled: !configPlugin,
        }}
        width={720}
        destroyOnHidden
      >
        {renderConfigModalContent()}
      </Modal>
    </>
  );
}

export default PluginMarketPanel;
