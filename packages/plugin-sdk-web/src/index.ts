import type {
  PluginCommandDescriptor,
  PluginCommandV2,
  PluginContributionSummary,
  PluginContributionV2,
  PluginDocToolContributionV2,
  PluginEditorBlockContributionDescriptor,
  PluginMenuContributionDescriptor,
  PluginMenuContributionV2,
  PluginRouteContributionDescriptor,
  PluginRouteContributionV2,
} from "../../plugin-sdk-shared/src/index.js";

export type WebExtension = unknown;
export type WebReactNode = unknown;

export type DocEditorBuiltinModule = Record<string, unknown>;

export type DocEditorRuntimeSdk = {
  builtins: {
    list: () => string[];
  };
  loadBuiltinModule: (name: string) => Promise<DocEditorBuiltinModule>;
  resolveAssetUrl: (relativePath: string) => string;
  loadStyle: (relativePath: string) => string;
  react: {
    createElement: unknown;
    Fragment: unknown;
  };
  tiptap: {
    Node: unknown;
    Mark: unknown;
    Extension: unknown;
    InputRule: unknown;
    mergeAttributes: unknown;
    ReactNodeViewRenderer: unknown;
  };
};

export type WebPluginLocalDataScope = "project" | "global";
export type WebPluginLocalDataEncoding = "utf8" | "base64";

export type WebPluginLocalDataEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
  updatedAt?: string;
};

export type WebPluginLocalDataFile = {
  path: string;
  content: string;
  encoding: WebPluginLocalDataEncoding;
  size: number;
  updatedAt: string;
};

export type WebTraceLevel = "DEBUG" | "DEFAULT" | "WARNING" | "ERROR";

export type WebTraceUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type WebTraceGenerationParams = {
  name: string;
  model: string;
  provider?: string;
  input: unknown;
  output?: string;
  usage?: WebTraceUsage;
  startTime?: string | Date;
  endTime?: string | Date;
  level?: WebTraceLevel;
  statusMessage?: string;
  metadata?: Record<string, unknown>;
};

export type WebTraceApi = {
  isEnabled: () => Promise<boolean>;
  startSpan: (
    name: string,
    input?: unknown,
  ) => Promise<{ spanId: string; traceId?: string } | null>;
  endSpan: (
    spanId: string,
    output?: unknown,
    level?: WebTraceLevel,
  ) => Promise<{ ok: boolean; traceEnded?: boolean }>;
  logGeneration: (params: WebTraceGenerationParams) => Promise<{ ok: boolean; traceId?: string; traceEnded?: boolean }>;
  startGeneration: (
    params: Omit<WebTraceGenerationParams, "output" | "endTime">,
  ) => Promise<{ generationId: string; traceId?: string } | null>;
  endGeneration: (
    generationId: string,
    output: string,
    usage?: WebTraceUsage,
    level?: WebTraceLevel,
    statusMessage?: string,
  ) => Promise<{ ok: boolean; traceEnded?: boolean }>;
};

export type WebPluginLocalDataClient = {
  listFiles: (options?: {
    scope?: WebPluginLocalDataScope;
    dir?: string;
    limit?: number;
    projectRef?: string;
  }) => Promise<WebPluginLocalDataEntry[]>;
  readFile: (path: string, options?: {
    scope?: WebPluginLocalDataScope;
    encoding?: WebPluginLocalDataEncoding;
    projectRef?: string;
  }) => Promise<WebPluginLocalDataFile>;
  writeFile: (path: string, content: string, options?: {
    scope?: WebPluginLocalDataScope;
    encoding?: WebPluginLocalDataEncoding;
    overwrite?: boolean;
    projectRef?: string;
  }) => Promise<{
    path: string;
    size: number;
    updatedAt: string;
  }>;
  deleteFile: (path: string, options?: {
    scope?: WebPluginLocalDataScope;
    projectRef?: string;
  }) => Promise<boolean>;
};

export type EditorBlockContribution = {
  id: string;
  blockType: string;
  title: string;
  requiresBlockId?: boolean;
  extension?: WebExtension | (() => WebExtension);
  toolbarButton?: WebReactNode | (() => WebReactNode);
  fallbackRenderer?: (node: unknown) => WebReactNode;
  textExtractor?: (node: unknown) => string;
};

export type MenuContribution = PluginMenuContributionDescriptor & {
  render?: () => WebReactNode;
  onClick?: (ctx: WebPluginContext) => void | Promise<void>;
};

export type MenuContributionV2 = PluginMenuContributionV2 & {
  render?: () => WebReactNode;
  onClick?: (ctx: WebPluginContext) => void | Promise<void>;
};

export type RouteContribution = PluginRouteContributionDescriptor & {
  render?: () => WebReactNode;
};

export type RouteContributionV2 = PluginRouteContributionV2 & {
  render?: () => WebReactNode;
};

export type DocToolContributionV2 = PluginDocToolContributionV2 & {
  onClick?: (ctx: WebPluginContext) => void | Promise<void>;
};

export type WebContributions = {
  summary?: Partial<PluginContributionSummary>;
  editorBlocks?: EditorBlockContribution[];
  menus?: MenuContribution[];
  routes?: RouteContribution[];
  commands?: PluginCommandDescriptor[];
};

export type WebContributionsV2 = {
  summary?: Partial<PluginContributionV2>;
  blocks?: EditorBlockContribution[];
  menus?: MenuContributionV2[];
  routes?: RouteContributionV2[];
  docTools?: DocToolContributionV2[];
  commands?: PluginCommandV2[];
};

export type WebPluginContext = {
  pluginId: string;
  projectKey?: string;
  userId?: string;
  emitEvent: (event: string, payload?: Record<string, unknown>) => void;
  invokeOperation: (
    pluginId: string,
    operationId: string,
    input?: Record<string, unknown>,
    projectRef?: string,
  ) => Promise<Record<string, unknown>>;
  localData?: WebPluginLocalDataClient;
  docEditor?: DocEditorRuntimeSdk;
  trace: WebTraceApi;
};

export type ZeusWebPlugin = {
  register: (ctx: WebPluginContext) => WebContributions | Promise<WebContributions>;
};

export type ZeusWebPluginV2 = {
  register: (ctx: WebPluginContext) => WebContributionsV2 | Promise<WebContributionsV2>;
};

export type WebPluginModule = {
  default?: ZeusWebPlugin;
  plugin?: ZeusWebPlugin;
};

export type WebPluginModuleV2 = {
  default?: ZeusWebPluginV2;
  plugin?: ZeusWebPluginV2;
};

export function toEditorBlockSummary(
  contributions: EditorBlockContribution[] | undefined,
): PluginEditorBlockContributionDescriptor[] {
  return (contributions || []).map((item) => ({
    id: item.id,
    blockType: item.blockType,
    title: item.title,
    requiresBlockId: item.requiresBlockId,
  }));
}
