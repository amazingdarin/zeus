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
  docEditor?: DocEditorRuntimeSdk;
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
