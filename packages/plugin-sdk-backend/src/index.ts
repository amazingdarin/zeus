import type {
  BeforeHookResultV2,
  PluginDocHookContributionV2,
  PluginOperationDescriptor,
  PluginRiskLevel,
} from "../../plugin-sdk-shared/src/index.js";

export type DocumentOperationContribution = PluginOperationDescriptor & {
  inputSchema?: Record<string, unknown>;
};

export type BackendHostRpc = {
  getDocument: (projectKey: string, docId: string) => Promise<Record<string, unknown> | null>;
  listDocuments: (projectKey: string, parentId?: string) => Promise<Record<string, unknown>[]>;
  createDocument: (projectKey: string, doc: Record<string, unknown>) => Promise<Record<string, unknown>>;
  updateDocument: (projectKey: string, doc: Record<string, unknown>) => Promise<Record<string, unknown>>;
  moveDocument: (
    projectKey: string,
    docId: string,
    targetParentId: string,
    beforeDocId?: string,
    afterDocId?: string,
  ) => Promise<Record<string, unknown>>;
  deleteDocument: (projectKey: string, docId: string, recursive?: boolean) => Promise<Record<string, unknown>>;
  saveDocument: (projectKey: string, doc: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getAssetMeta: (projectKey: string, assetId: string) => Promise<Record<string, unknown> | null>;
  searchKnowledge: (
    projectKey: string,
    query: string,
    limit?: number,
  ) => Promise<Record<string, unknown>>;
  getKnowledgeSources: (
    projectKey: string,
    query: string,
    limit?: number,
  ) => Promise<Record<string, unknown>>;
  fetchUrl: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
};

export type BackendPluginContext = {
  pluginId: string;
  projectKey: string;
  userId: string;
  capabilities?: string[];
  permissions: {
    allowedHttpHosts: string[];
    maxExecutionMs: number;
  };
  host: BackendHostRpc;
};

export type ZeusBackendPlugin = {
  listOperations?: () => DocumentOperationContribution[] | Promise<DocumentOperationContribution[]>;
  listHooks?: () => PluginDocHookContributionV2[] | Promise<PluginDocHookContributionV2[]>;
  execute?: (
    operationId: string,
    input: Record<string, unknown>,
    ctx: BackendPluginContext,
  ) => Promise<Record<string, unknown>>;
  executeCommand?: (
    commandId: string,
    input: Record<string, unknown>,
    ctx: BackendPluginContext,
  ) => Promise<Record<string, unknown>>;
  runHook?: (
    hookId: string,
    input: Record<string, unknown>,
    ctx: BackendPluginContext,
  ) => Promise<BeforeHookResultV2 | Record<string, unknown> | void>;
};

export type BackendPluginModule = {
  default?: ZeusBackendPlugin;
  plugin?: ZeusBackendPlugin;
};

export function normalizeRiskLevel(value: unknown, fallback: PluginRiskLevel = "medium"): PluginRiskLevel {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return fallback;
}
