import type {
  BeforeHookResultV2,
  PluginActivationV2,
  PluginDocHookContributionV2,
  PluginDocHookEventV2,
  PluginManifestV2,
  PluginPermissionPolicyV2,
  PluginRegisteredCommandV2,
  PluginRuntimeItemV2,
} from "@zeus/plugin-sdk-shared";

export type InstalledPluginV2 = {
  installation: {
    userId: string;
    pluginId: string;
    version: string;
    enabled: boolean;
    status: "installing" | "installed" | "failed" | "uninstalled";
    installedAt: string;
    updatedAt: string;
    lastError?: string | null;
    manifestApiVersion?: number;
    capabilities?: string[];
    activation?: PluginActivationV2;
  };
  manifest: PluginManifestV2;
};

export type ExecutePluginOperationInputV2 = {
  userId: string;
  projectKey: string;
  pluginId: string;
  operationId: string;
  args?: Record<string, unknown>;
};

export type ExecutePluginCommandInputV2 = {
  userId: string;
  projectKey: string;
  commandId: string;
  args?: Record<string, unknown>;
  source: "api" | "slash" | "palette" | "tool" | "hook";
  requestId?: string;
};

export type PluginCommandRuntimeItemV2 = PluginRegisteredCommandV2;

export type PluginHookRuntimeItemV2 = PluginDocHookContributionV2 & {
  pluginId: string;
  version: string;
  handler: string;
  permissions: PluginPermissionPolicyV2;
};

export type HookDispatchInputV2 = {
  userId: string;
  projectKey: string;
  event: PluginDocHookEventV2;
  payload: Record<string, unknown>;
  requestId?: string;
};

export type HookBeforeResultV2 = {
  allowed: boolean;
  payload: Record<string, unknown>;
  rejection?: {
    code: string;
    message: string;
    status: number;
  };
};

export type WorkerPermissionPolicyV2 = {
  allowedHttpHosts: string[];
  maxExecutionMs: number;
};

export type PluginManifestDiskLoadV2 = {
  pluginId: string;
  version: string;
  manifest: PluginManifestV2;
};

export type RuntimePayloadV2 = {
  plugins: PluginRuntimeItemV2[];
};

export type SnapshotPayloadV2 = {
  commands: PluginRegisteredCommandV2[];
  hooks: PluginDocHookContributionV2[];
  routes: Array<{ id: string; path: string; title?: string; entry?: string; order?: number }>;
  tools: Array<{
    id: string;
    placement: "editorToolbar" | "documentHeader" | "contextMenu";
    commandId: string;
    title: string;
    order?: number;
    requiresDocScope?: boolean;
  }>;
};

export type HookWorkerResultV2 = BeforeHookResultV2 | Record<string, unknown> | void;
