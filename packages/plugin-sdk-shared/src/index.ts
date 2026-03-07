export const PLUGIN_API_VERSION = 1;
export const PLUGIN_API_VERSION_V2 = 2;

export type PluginCapabilityLegacy =
  | "editor.block.register"
  | "doc.operation.execute"
  | "menu.module.mount"
  | "route.module.mount";

export type PluginCapabilityV2 =
  | "docs.read"
  | "docs.write"
  | "docs.hook.before"
  | "docs.hook.after"
  | "docs.tool.register"
  | "docs.block.register"
  | "system.command.register"
  | "ui.menu.register"
  | "ui.route.register"
  | "system.service.register";

export type PluginCapability = PluginCapabilityLegacy | PluginCapabilityV2;

export type PluginRiskLevel = "low" | "medium" | "high";

export type PluginPermissionPolicy = {
  allowedHttpHosts?: string[];
  maxExecutionMs?: number;
};

export type PluginPermissionPolicyV2 = PluginPermissionPolicy & {
  maxHookExecutionMs?: number;
};

export type PluginSettingsFieldType =
  | "string"
  | "textarea"
  | "number"
  | "boolean"
  | "select";

export type PluginSettingsSelectOption = {
  label: string;
  value: string;
  description?: string;
};

export type PluginSettingsField = {
  key: string;
  title: string;
  description?: string;
  type: PluginSettingsFieldType;
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  secret?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: PluginSettingsSelectOption[];
};

export type PluginSettingsSchema = {
  title?: string;
  description?: string;
  fields: PluginSettingsField[];
};

export type PluginCommandDescriptor = {
  id: string;
  command: string;
  name: string;
  description: string;
  category?: string;
  requiresDocScope?: boolean;
  operationId: string;
};

export type PluginCommandV2 = {
  id: string;
  title: string;
  description: string;
  category?: string;
  inputSchema?: Record<string, unknown>;
  slashAliases?: string[];
  apiEnabled?: boolean;
  requiresDocScope?: boolean;
  handler?: string;
};

export type PluginMenuContributionDescriptor = {
  id: string;
  placement: "sidebar" | "document_header" | "settings";
  title: string;
  order?: number;
  icon?: string;
  action?: string;
  route?: string;
};

export type PluginMenuPlacementV2 = "sidebar" | "documentHeader" | "settings";

export type PluginMenuContributionV2 = {
  id: string;
  placement: PluginMenuPlacementV2;
  title: string;
  order?: number;
  icon?: string;
  commandId?: string;
  routeId?: string;
};

export type PluginRouteContributionDescriptor = {
  id: string;
  path: string;
  title?: string;
  order?: number;
};

export type PluginRouteContributionV2 = {
  id: string;
  path: string;
  title?: string;
  entry?: string;
  order?: number;
};

export type PluginDocToolPlacementV2 = "editorToolbar" | "documentHeader" | "contextMenu";

export type PluginDocToolContributionV2 = {
  id: string;
  placement: PluginDocToolPlacementV2;
  commandId: string;
  title: string;
  order?: number;
  requiresDocScope?: boolean;
};

export type PluginDocHookStageV2 = "before" | "after";

export type PluginDocHookEventV2 =
  | "document.create"
  | "document.update"
  | "document.delete"
  | "document.move"
  | "document.import"
  | "document.optimize";

export type PluginDocHookContributionV2 = {
  id: string;
  stage: PluginDocHookStageV2;
  event: PluginDocHookEventV2;
  priority?: number;
  requiresDocScope?: boolean;
  handler?: string;
};

export type PluginEditorBlockContributionDescriptor = {
  id: string;
  blockType: string;
  title: string;
  requiresBlockId?: boolean;
};

export type PluginBlockContributionV2 = {
  blockType: string;
  requiresBlockId?: boolean;
  rendererEntry?: string;
  markdownCodec?: string;
  textExtractor?: string;
};

export type PluginOperationDescriptor = {
  id: string;
  title: string;
  description: string;
  riskLevel?: PluginRiskLevel;
  requiresDocScope?: boolean;
};

export type PluginServiceKindV2 = "importer" | "exporter" | "converter" | "analyzer";

export type PluginServiceContributionV2 = {
  id: string;
  kind: PluginServiceKindV2;
  commandId: string;
  title?: string;
  description?: string;
};

export type PluginContributionSummary = {
  editorBlocks?: PluginEditorBlockContributionDescriptor[];
  operations?: PluginOperationDescriptor[];
  menus?: PluginMenuContributionDescriptor[];
  routes?: PluginRouteContributionDescriptor[];
};

export type PluginActivationV2 = {
  commands?: string[];
  routes?: string[];
  tools?: string[];
  documentEvents?: PluginDocHookEventV2[];
};

export type PluginContributionV2 = {
  commands?: PluginCommandV2[];
  docHooks?: PluginDocHookContributionV2[];
  docTools?: PluginDocToolContributionV2[];
  blocks?: PluginBlockContributionV2[];
  menus?: PluginMenuContributionV2[];
  routes?: PluginRouteContributionV2[];
  services?: PluginServiceContributionV2[];
};

export type PluginManifest = {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  pluginApiVersion: number;
  engines: {
    zeusAppBackend?: string;
    zeusWeb?: string;
  };
  capabilities: PluginCapability[];
  frontend?: {
    entry?: string;
  };
  backend?: {
    entry?: string;
  };
  commands?: PluginCommandDescriptor[];
  permissions?: PluginPermissionPolicy;
  settings?: PluginSettingsSchema;
  contributions?: PluginContributionSummary;
  integrity?: string;
  signature?: string;
};

export type PluginManifestV2 = {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  pluginApiVersion: 2;
  engines: {
    zeusAppBackend?: string;
    zeusWeb?: string;
  };
  capabilities: PluginCapabilityV2[];
  activation: PluginActivationV2;
  contributes: PluginContributionV2;
  frontend?: {
    entry?: string;
  };
  backend?: {
    entry?: string;
  };
  permissions?: PluginPermissionPolicyV2;
  settings?: PluginSettingsSchema;
  integrity?: string;
  signature?: string;
};

export type PluginStoreVersion = {
  pluginId: string;
  version: string;
  packageUrl: string;
  manifest: PluginManifest;
  publishedAt?: string;
};

export type PluginStoreVersionV2 = {
  pluginId: string;
  version: string;
  packageUrl: string;
  manifest: PluginManifestV2;
  publishedAt?: string;
};

export type PluginStorePluginSummary = {
  pluginId: string;
  latestVersion: string;
  displayName: string;
  description?: string;
  versions: string[];
  tags?: string[];
};

export type PluginStoreCatalog = {
  plugins: PluginStorePluginSummary[];
};

export type PluginInstallationStatus =
  | "installing"
  | "installed"
  | "failed"
  | "uninstalled";

export type PluginInstallationRecord = {
  userId: string;
  pluginId: string;
  version: string;
  enabled: boolean;
  status: PluginInstallationStatus;
  installedAt: string;
  updatedAt: string;
  lastError?: string | null;
};

export type PluginInstallationRecordV2 = PluginInstallationRecord & {
  manifestApiVersion?: number;
  capabilities?: string[];
  activation?: PluginActivationV2;
};

export type PluginRuntimeItem = {
  pluginId: string;
  version: string;
  displayName: string;
  frontendEntryUrl?: string;
  capabilities: PluginCapability[];
  commands: PluginCommandDescriptor[];
  contributions: PluginContributionSummary;
};

export type PluginRuntimeItemV2 = {
  pluginId: string;
  version: string;
  displayName: string;
  frontendEntryUrl?: string;
  capabilities: PluginCapabilityV2[];
  activation: PluginActivationV2;
  contributes: PluginContributionV2;
};

export type PluginRegisteredCommandV2 = {
  pluginId: string;
  version: string;
  commandId: string;
  title: string;
  description: string;
  category?: string;
  slashAliases: string[];
  apiEnabled: boolean;
  requiresDocScope: boolean;
  handler: string;
};

export type BeforeHookDecisionV2 = "allow" | "mutate" | "reject";

export type BeforeHookResultV2 = {
  decision: BeforeHookDecisionV2;
  payload?: Record<string, unknown>;
  patch?: Array<{ op: "add" | "remove" | "replace"; path: string; value?: unknown }>;
  errorCode?: string;
  message?: string;
};
