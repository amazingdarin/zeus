import type {
  PluginManifestV2,
  PluginRegisteredCommandV2,
  PluginRuntimeItemV2,
  PluginStorePluginSummary,
  PluginStoreVersionV2,
} from "@zeus/plugin-sdk-shared";

import { apiFetch, encodeProjectRef } from "../config/api";

export type InstalledPlugin = {
  installation: {
    userId: string;
    pluginId: string;
    version: string;
    enabled: boolean;
    status: string;
    installedAt: string;
    updatedAt: string;
    lastError?: string | null;
    manifestApiVersion?: number;
    capabilities?: string[];
    activation?: Record<string, unknown>;
  };
  manifest: PluginManifestV2;
};

export async function listPluginStore(query = ""): Promise<PluginStorePluginSummary[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`/api/plugins/v2/store${suffix}`);
  if (!response.ok) {
    throw new Error("Failed to list plugin store");
  }
  const payload = await response.json() as { data?: { plugins?: PluginStorePluginSummary[] } };
  return payload?.data?.plugins || [];
}

export async function listPluginVersions(pluginId: string): Promise<PluginStoreVersionV2[]> {
  const response = await apiFetch(`/api/plugins/v2/store/${encodeURIComponent(pluginId)}/versions`);
  if (!response.ok) {
    throw new Error("Failed to list plugin versions");
  }
  const payload = await response.json() as { data?: { versions?: PluginStoreVersionV2[] } };
  return payload?.data?.versions || [];
}

export async function listMyPlugins(): Promise<InstalledPlugin[]> {
  const response = await apiFetch("/api/plugins/v2/me");
  if (!response.ok) {
    throw new Error("Failed to list installed plugins");
  }
  const payload = await response.json() as { data?: InstalledPlugin[] };
  return payload?.data || [];
}

export async function installPlugin(pluginId: string, version?: string): Promise<InstalledPlugin> {
  const response = await apiFetch("/api/plugins/v2/me/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pluginId, version }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to install plugin");
  }
  const payload = await response.json() as { data?: InstalledPlugin };
  if (!payload?.data) {
    throw new Error("Plugin install returned empty result");
  }
  return payload.data;
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<InstalledPlugin["installation"]> {
  const response = await apiFetch(`/api/plugins/v2/me/${encodeURIComponent(pluginId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to update plugin state");
  }
  const payload = await response.json() as { data?: InstalledPlugin["installation"] };
  if (!payload?.data) {
    throw new Error("Plugin state update returned empty result");
  }
  return payload.data;
}

export async function uninstallPlugin(pluginId: string): Promise<boolean> {
  const response = await apiFetch(`/api/plugins/v2/me/${encodeURIComponent(pluginId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to uninstall plugin");
  }
  const payload = await response.json() as { data?: { deleted?: boolean } };
  return payload?.data?.deleted === true;
}

export async function getPluginRuntime(): Promise<PluginRuntimeItemV2[]> {
  const response = await apiFetch("/api/plugins/v2/me/runtime");
  if (!response.ok) {
    throw new Error("Failed to load plugin runtime");
  }
  const payload = await response.json() as { data?: { plugins?: PluginRuntimeItemV2[] } };
  return payload?.data?.plugins || [];
}

export async function getPluginRuntimeCommands(): Promise<PluginRegisteredCommandV2[]> {
  const response = await apiFetch("/api/plugins/v2/me/commands");
  if (!response.ok) {
    throw new Error("Failed to load plugin commands");
  }
  const payload = await response.json() as { data?: { commands?: PluginRegisteredCommandV2[] } };
  return payload?.data?.commands || [];
}

export async function getPluginSettings(pluginId: string): Promise<Record<string, unknown>> {
  const response = await apiFetch(`/api/plugins/v2/me/${encodeURIComponent(pluginId)}/settings`);
  if (!response.ok) {
    throw new Error("Failed to get plugin settings");
  }
  const payload = await response.json() as { data?: { settings?: Record<string, unknown> } };
  return payload?.data?.settings || {};
}

export async function setPluginSettings(
  pluginId: string,
  settings: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await apiFetch(`/api/plugins/v2/me/${encodeURIComponent(pluginId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error("Failed to update plugin settings");
  }
  const payload = await response.json() as { data?: { settings?: Record<string, unknown> } };
  return payload?.data?.settings || {};
}

export async function executePluginCommand(
  projectRef: string,
  commandId: string,
  input: Record<string, unknown> = {},
  options?: {
    source?: "api" | "palette" | "tool";
  },
): Promise<Record<string, unknown>> {
  const encodedProject = encodeProjectRef(projectRef);
  const body: Record<string, unknown> = { ...input };
  if (options?.source) {
    body.__source = options.source;
  }
  const response = await apiFetch(
    `/api/projects/${encodedProject}/plugin-commands/${encodeURIComponent(commandId)}/execute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to execute plugin command");
  }
  const payload = await response.json() as { data?: Record<string, unknown> };
  return payload?.data || {};
}

// Backward compatibility helper. v2 routes execute by commandId.
export async function executePluginOperation(
  projectRef: string,
  pluginId: string,
  operationId: string,
  input: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  void pluginId;
  return executePluginCommand(projectRef, operationId, input, { source: "api" });
}
