import type {
  BeforeHookResultV2,
  PluginDocHookContributionV2,
  PluginOperationDescriptor,
  PluginRiskLevel,
} from "../../plugin-sdk-shared/src/index.js";

export type DocumentOperationContribution = PluginOperationDescriptor & {
  inputSchema?: Record<string, unknown>;
};

export type BackendPluginLocalDataScope = "project" | "global";
export type BackendPluginLocalDataEncoding = "utf8" | "base64";

export type BackendPluginLocalDataEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
  updatedAt?: string;
};

export type BackendPluginLocalDataFile = {
  path: string;
  content: string;
  encoding: BackendPluginLocalDataEncoding;
  size: number;
  updatedAt: string;
};

export type BackendPptAssetMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
};

export type BackendGeneratePptFromHtmlOptions = {
  fileName?: string;
  style?: {
    description?: string;
    templateId?: string;
    templateImages?: string[];
  };
  options?: {
    aspectRatio?: "16:9" | "4:3";
    language?: string;
  };
  waitMs?: number;
  pollIntervalMs?: number;
};

export type BackendTraceLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";

export type BackendTraceUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type BackendTraceGenerationParams = {
  name: string;
  model: string;
  provider?: string;
  input: unknown;
  output?: string;
  usage?: BackendTraceUsage;
  startTime?: string | Date;
  endTime?: string | Date;
  level?: BackendTraceLevel;
  statusMessage?: string;
  metadata?: Record<string, unknown>;
};

export type BackendTraceApi = {
  isEnabled: () => Promise<boolean>;
  startSpan: (
    name: string,
    input?: unknown,
  ) => Promise<{ spanId: string } | null>;
  endSpan: (
    spanId: string,
    output?: unknown,
    level?: BackendTraceLevel,
  ) => Promise<{ ok: boolean }>;
  logGeneration: (params: BackendTraceGenerationParams) => Promise<{ ok: boolean }>;
  startGeneration: (
    params: Omit<BackendTraceGenerationParams, "output" | "endTime">,
  ) => Promise<{ generationId: string } | null>;
  endGeneration: (
    generationId: string,
    output: string,
    usage?: BackendTraceUsage,
    level?: BackendTraceLevel,
    statusMessage?: string,
  ) => Promise<{ ok: boolean }>;
};

export type BackendHostRpc = {
  getPluginSettings: (pluginId?: string) => Promise<Record<string, unknown>>;
  listPluginDataFiles: (options?: {
    pluginId?: string;
    projectKey?: string;
    scope?: BackendPluginLocalDataScope;
    dir?: string;
    limit?: number;
  }) => Promise<BackendPluginLocalDataEntry[]>;
  readPluginDataFile: (
    path: string,
    options?: {
      pluginId?: string;
      projectKey?: string;
      scope?: BackendPluginLocalDataScope;
      encoding?: BackendPluginLocalDataEncoding;
    },
  ) => Promise<BackendPluginLocalDataFile>;
  writePluginDataFile: (
    path: string,
    content: string,
    options?: {
      pluginId?: string;
      projectKey?: string;
      scope?: BackendPluginLocalDataScope;
      encoding?: BackendPluginLocalDataEncoding;
      overwrite?: boolean;
    },
  ) => Promise<{
    path: string;
    size: number;
    updatedAt: string;
  }>;
  deletePluginDataFile: (
    path: string,
    options?: {
      pluginId?: string;
      projectKey?: string;
      scope?: BackendPluginLocalDataScope;
    },
  ) => Promise<{ deleted: boolean }>;
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
  exportDocumentPpt: (
    projectKey: string,
    docId: string,
    request?: {
      style?: {
        description?: string;
        templateId?: string;
        templateImages?: string[];
      };
      options?: {
        aspectRatio?: "16:9" | "4:3";
        language?: string;
      };
    },
  ) => Promise<{
    taskId: string;
    status: string;
  }>;
  generatePptFromHtml: (
    projectKey: string,
    html: string,
    options?: BackendGeneratePptFromHtmlOptions,
  ) => Promise<{
    taskId: string;
    status: string;
    asset?: BackendPptAssetMeta | null;
    error?: string;
    waitedMs?: number;
  }>;
  getPptTaskStatus: (taskId: string) => Promise<{
    taskId: string;
    status: string;
    progress?: number;
    currentSlide?: number;
    totalSlides?: number;
    error?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
  fetchUrl: (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
  trace: BackendTraceApi;
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
