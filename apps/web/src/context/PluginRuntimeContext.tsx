import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Extensions } from "@tiptap/core";
import type {
  PluginRegisteredCommandV2,
  PluginRuntimeItemV2,
} from "@zeus/plugin-sdk-shared";
import type {
  EditorBlockContribution,
  MenuContribution,
  RouteContribution,
  WebPluginModule,
  WebPluginModuleV2,
  ZeusWebPlugin,
  ZeusWebPluginV2,
} from "@zeus/plugin-sdk-web";
import { registerDocEditorBlockIdNodeTypes } from "@zeus/doc-editor";

import {
  executePluginCommand,
  getPluginRuntime,
  getPluginRuntimeCommands,
} from "../api/plugins";

const LAST_PROJECT_REF_STORAGE_KEY = "zeus.lastProjectRef";

type RuntimeWebPluginModule = WebPluginModule | WebPluginModuleV2;

const BUILTIN_PLUGIN_MODULE_LOADERS: Record<string, () => Promise<RuntimeWebPluginModule>> = {
  "music-plugin": async () => {
    const mod = await import("../plugins/music-plugin");
    return mod as unknown as RuntimeWebPluginModule;
  },
};

type PluginMenuPlacement = "sidebar" | "document_header" | "settings";

export type PluginMenuEntry = {
  id: string;
  pluginId: string;
  title: string;
  placement: PluginMenuPlacement;
  order: number;
  icon?: string;
  route?: string;
  action?: string;
  execute?: () => Promise<void>;
};

export type PluginRouteEntry = {
  id: string;
  pluginId: string;
  title?: string;
  path: string;
  order: number;
  render?: () => ReactNode;
};

export type PluginEditorContributions = {
  extraExtensions: Extensions;
  toolbarItems: ReactNode[];
  blockIdNodeTypes: string[];
};

type PluginRuntimeContextValue = {
  loading: boolean;
  error: string | null;
  plugins: PluginRuntimeItemV2[];
  commands: PluginRegisteredCommandV2[];
  sidebarMenus: PluginMenuEntry[];
  documentHeaderMenus: PluginMenuEntry[];
  routes: PluginRouteEntry[];
  editorContributions: PluginEditorContributions;
  refresh: () => void;
  runMenuAction: (
    menu: PluginMenuEntry,
    input?: Record<string, unknown>,
    projectRefOverride?: string,
  ) => Promise<Record<string, unknown> | null>;
  executeCommand: (
    commandId: string,
    input?: Record<string, unknown>,
    projectRefOverride?: string,
    source?: "api" | "palette" | "tool",
  ) => Promise<Record<string, unknown>>;
  invokeOperation: (
    pluginId: string,
    operationId: string,
    input?: Record<string, unknown>,
    projectRefOverride?: string,
  ) => Promise<Record<string, unknown>>;
};

const PluginRuntimeContext = createContext<PluginRuntimeContextValue | undefined>(undefined);

function resolveProjectRef(projectRefOverride?: string): string {
  const fromArg = String(projectRefOverride || "").trim();
  if (fromArg) return fromArg;
  const fromStorage = localStorage.getItem(LAST_PROJECT_REF_STORAGE_KEY);
  const normalized = String(fromStorage || "").trim();
  if (!normalized) {
    throw new Error("Missing project context for plugin operation");
  }
  return normalized;
}

function normalizeRoutePath(pathValue: string | undefined, pluginId: string, fallbackId: string): string {
  const raw = String(pathValue || "").trim();
  if (!raw) {
    return `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(fallbackId)}`;
  }
  if (raw.startsWith("/")) {
    return raw;
  }
  return `/plugins/${encodeURIComponent(pluginId)}/${raw.replace(/^\/+/, "")}`;
}

function normalizeMenuPlacement(value: unknown): PluginMenuPlacement | null {
  const raw = String(value || "").trim();
  if (raw === "sidebar") return "sidebar";
  if (raw === "settings") return "settings";
  if (raw === "document_header" || raw === "documentHeader") return "document_header";
  return null;
}

function getRoutePathById(
  pluginId: string,
  routes: Array<{ id: string; path: string }>,
  routeId: string,
): string | undefined {
  const route = routes.find((item) => item.id === routeId);
  if (!route) return undefined;
  return normalizeRoutePath(route.path, pluginId, route.id);
}

function toRouteEntriesFromManifest(
  pluginId: string,
  routes: Array<{ id: string; path: string; title?: string; order?: number }> | undefined,
): PluginRouteEntry[] {
  const entries: PluginRouteEntry[] = [];
  for (const item of routes || []) {
    const id = String(item.id || "").trim();
    if (!id) continue;
    entries.push({
      id,
      pluginId,
      title: item.title,
      path: normalizeRoutePath(item.path, pluginId, id),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : 1000,
    });
  }
  return entries;
}

function toMenuEntriesFromManifest(input: {
  pluginId: string;
  menus:
    | Array<{
      id: string;
      placement: string;
      title: string;
      order?: number;
      icon?: string;
      commandId?: string;
      routeId?: string;
    }>
    | undefined;
  routes: Array<{ id: string; path: string }>;
}): PluginMenuEntry[] {
  const entries: PluginMenuEntry[] = [];
  for (const item of input.menus || []) {
    const id = String(item.id || "").trim();
    const placement = normalizeMenuPlacement(item.placement);
    if (!id || !placement) continue;

    const route = item.routeId
      ? getRoutePathById(input.pluginId, input.routes, item.routeId)
      : undefined;

    entries.push({
      id,
      pluginId: input.pluginId,
      title: String(item.title || id).trim(),
      placement,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : 1000,
      icon: item.icon,
      route,
      action: item.commandId || undefined,
    });
  }
  return entries;
}

function toMenuEntriesFromDocTools(input: {
  pluginId: string;
  tools:
    | Array<{
      id: string;
      placement: "editorToolbar" | "documentHeader" | "contextMenu";
      commandId: string;
      title: string;
      order?: number;
    }>
    | undefined;
}): PluginMenuEntry[] {
  const entries: PluginMenuEntry[] = [];
  for (const tool of input.tools || []) {
    const id = String(tool.id || "").trim();
    const commandId = String(tool.commandId || "").trim();
    if (!id || !commandId) continue;

    let placement: PluginMenuPlacement | null = null;
    if (tool.placement === "documentHeader") {
      placement = "document_header";
    } else if (tool.placement === "contextMenu") {
      placement = "document_header";
    } else if (tool.placement === "editorToolbar") {
      placement = null;
    }
    if (!placement) continue;

    entries.push({
      id: `tool:${id}`,
      pluginId: input.pluginId,
      title: String(tool.title || id).trim(),
      placement,
      order: Number.isFinite(Number(tool.order)) ? Number(tool.order) : 1000,
      action: commandId,
    });
  }
  return entries;
}

function toMenuEntriesFromSummary(
  pluginId: string,
  summary: unknown,
  routeMap: Array<{ id: string; path: string }>,
): PluginMenuEntry[] {
  if (!summary || typeof summary !== "object") {
    return [];
  }
  const row = summary as Record<string, unknown>;
  const menus = Array.isArray(row.menus) ? row.menus : [];
  const entries: PluginMenuEntry[] = [];

  for (const menuItem of menus) {
    if (!menuItem || typeof menuItem !== "object") continue;
    const item = menuItem as Record<string, unknown>;
    const id = String(item.id || "").trim();
    const placement = normalizeMenuPlacement(item.placement);
    if (!id || !placement) continue;

    const route = typeof item.route === "string" && item.route.trim()
      ? normalizeRoutePath(item.route, pluginId, id)
      : (typeof item.routeId === "string"
        ? getRoutePathById(pluginId, routeMap, item.routeId)
        : undefined);

    entries.push({
      id,
      pluginId,
      title: String(item.title || id).trim(),
      placement,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : 1000,
      icon: typeof item.icon === "string" ? item.icon : undefined,
      route,
      action: typeof item.action === "string"
        ? item.action
        : (typeof item.commandId === "string" ? item.commandId : undefined),
    });
  }

  return entries;
}

function toRouteEntriesFromSummary(
  pluginId: string,
  summary: unknown,
): PluginRouteEntry[] {
  if (!summary || typeof summary !== "object") {
    return [];
  }
  const row = summary as Record<string, unknown>;
  const routes = Array.isArray(row.routes) ? row.routes : [];
  const entries: PluginRouteEntry[] = [];
  for (const routeItem of routes) {
    if (!routeItem || typeof routeItem !== "object") continue;
    const item = routeItem as Record<string, unknown>;
    const id = String(item.id || "").trim();
    if (!id) continue;
    entries.push({
      id,
      pluginId,
      title: typeof item.title === "string" ? item.title : undefined,
      path: normalizeRoutePath(String(item.path || ""), pluginId, id),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : 1000,
    });
  }
  return entries;
}

export function PluginRuntimeProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<PluginRuntimeItemV2[]>([]);
  const [commands, setCommands] = useState<PluginRegisteredCommandV2[]>([]);
  const [sidebarMenus, setSidebarMenus] = useState<PluginMenuEntry[]>([]);
  const [documentHeaderMenus, setDocumentHeaderMenus] = useState<PluginMenuEntry[]>([]);
  const [routes, setRoutes] = useState<PluginRouteEntry[]>([]);
  const [editorContributions, setEditorContributions] = useState<PluginEditorContributions>({
    extraExtensions: [],
    toolbarItems: [],
    blockIdNodeTypes: [],
  });
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  const executeCommand = useCallback(
    async (
      commandId: string,
      input: Record<string, unknown> = {},
      projectRefOverride?: string,
      source: "api" | "palette" | "tool" = "api",
    ): Promise<Record<string, unknown>> => {
      const projectRef = resolveProjectRef(projectRefOverride);
      return executePluginCommand(projectRef, commandId, input, { source });
    },
    [],
  );

  const invokeOperation = useCallback(
    async (
      _pluginId: string,
      operationId: string,
      input: Record<string, unknown> = {},
      projectRefOverride?: string,
    ): Promise<Record<string, unknown>> => {
      return executeCommand(operationId, input, projectRefOverride);
    },
    [executeCommand],
  );

  const runMenuAction = useCallback(
    async (
      menu: PluginMenuEntry,
      input: Record<string, unknown> = {},
      projectRefOverride?: string,
    ): Promise<Record<string, unknown> | null> => {
      if (menu.execute) {
        await menu.execute();
        return null;
      }
      if (menu.action) {
        return executeCommand(menu.action, input, projectRefOverride, "tool");
      }
      return null;
    },
    [executeCommand],
  );

  useEffect(() => {
    let cancelled = false;

    const loadRuntime = async () => {
      setLoading(true);
      setError(null);

      try {
        const [runtimeItems, runtimeCommands] = await Promise.all([
          getPluginRuntime(),
          getPluginRuntimeCommands(),
        ]);

        if (cancelled) return;

        const menuMap = new Map<string, PluginMenuEntry>();
        const routeMap = new Map<string, PluginRouteEntry>();
        const toolbarItems: ReactNode[] = [];
        const blockIdNodeTypes = new Set<string>();
        const extraExtensions: NonNullable<PluginEditorContributions["extraExtensions"]> = [];

        for (const runtimeItem of runtimeItems) {
          const pluginId = runtimeItem.pluginId;
          const routeEntries = toRouteEntriesFromManifest(pluginId, runtimeItem.contributes.routes || []);
          const routeRefMap = routeEntries.map((route) => ({ id: route.id, path: route.path }));

          for (const route of routeEntries) {
            routeMap.set(`${pluginId}:${route.id}`, route);
          }
          for (const menu of toMenuEntriesFromManifest({
            pluginId,
            menus: runtimeItem.contributes.menus,
            routes: routeRefMap,
          })) {
            menuMap.set(`${pluginId}:${menu.id}`, menu);
          }
          for (const menu of toMenuEntriesFromDocTools({
            pluginId,
            tools: runtimeItem.contributes.docTools,
          })) {
            menuMap.set(`${pluginId}:${menu.id}`, menu);
          }
          for (const tool of runtimeItem.contributes.docTools || []) {
            if (tool.placement !== "editorToolbar") continue;
            if (!tool.commandId) continue;
            toolbarItems.push(
              <button
                key={`plugin-tool-${pluginId}-${tool.id}`}
                type="button"
                onClick={() => {
                  void executeCommand(tool.commandId, {}, undefined, "tool").catch((err) => {
                    const message = err instanceof Error ? err.message : "插件工具执行失败";
                    console.warn(message);
                  });
                }}
                style={{
                  border: "1px solid #d9d9d9",
                  borderRadius: 6,
                  background: "#fff",
                  fontSize: 12,
                  padding: "2px 8px",
                  cursor: "pointer",
                }}
              >
                {tool.title}
              </button>,
            );
          }

          for (const block of runtimeItem.contributes.blocks || []) {
            if (block.requiresBlockId) {
              blockIdNodeTypes.add(block.blockType);
            }
          }

          const frontendEntry = String(runtimeItem.frontendEntryUrl || "").trim();
          let loaded: RuntimeWebPluginModule | null = null;
          try {
            if (frontendEntry) {
              loaded = await import(/* @vite-ignore */ frontendEntry) as RuntimeWebPluginModule;
            } else {
              const builtinLoader = BUILTIN_PLUGIN_MODULE_LOADERS[pluginId];
              if (builtinLoader) {
                loaded = await builtinLoader();
              }
            }
            if (!loaded) {
              continue;
            }
            const plugin = (loaded.default || loaded.plugin) as ZeusWebPlugin | ZeusWebPluginV2 | undefined;
            if (!plugin || typeof plugin.register !== "function") {
              continue;
            }

            const projectRefFromStorage = localStorage.getItem(LAST_PROJECT_REF_STORAGE_KEY) || undefined;
            const pluginContext = {
              pluginId,
              projectKey: projectRefFromStorage,
              userId: undefined,
              emitEvent: (event: string, payload?: Record<string, unknown>) => {
                window.dispatchEvent(
                  new CustomEvent(`zeus:plugin:${pluginId}:${event}`, {
                    detail: payload || {},
                  }),
                );
              },
              invokeOperation: (
                targetPluginId: string,
                operationId: string,
                input?: Record<string, unknown>,
                projectRef?: string,
              ) => invokeOperation(targetPluginId, operationId, input || {}, projectRef),
            };

            const contributions = await plugin.register(pluginContext);
            if (!contributions || typeof contributions !== "object") {
              continue;
            }

            const mergedSummary = (contributions as { summary?: unknown }).summary;
            for (const route of toRouteEntriesFromSummary(pluginId, mergedSummary)) {
              routeMap.set(`${pluginId}:${route.id}`, route);
            }
            const routeRefs = Array.from(routeMap.values())
              .filter((route) => route.pluginId === pluginId)
              .map((route) => ({ id: route.id, path: route.path }));
            for (const menu of toMenuEntriesFromSummary(pluginId, mergedSummary, routeRefs)) {
              menuMap.set(`${pluginId}:${menu.id}`, menu);
            }

            const blocks = Array.isArray((contributions as { blocks?: unknown }).blocks)
              ? (contributions as { blocks: EditorBlockContribution[] }).blocks
              : (Array.isArray((contributions as { editorBlocks?: unknown }).editorBlocks)
                ? (contributions as { editorBlocks: EditorBlockContribution[] }).editorBlocks
                : []);
            for (const block of blocks) {
              registerEditorBlockContribution(block, {
                toolbarItems,
                blockIdNodeTypes,
                extraExtensions,
              });
            }

            const menus = Array.isArray((contributions as { menus?: unknown }).menus)
              ? (contributions as { menus: MenuContribution[] }).menus
              : [];
            for (const menu of menus) {
              const normalized = normalizeMenuContribution(pluginId, menu, pluginContext, executeCommand);
              if (normalized) {
                menuMap.set(`${pluginId}:${normalized.id}`, normalized);
              }
            }

            const routeContributions = Array.isArray((contributions as { routes?: unknown }).routes)
              ? (contributions as { routes: RouteContribution[] }).routes
              : [];
            for (const route of routeContributions) {
              const normalized = normalizeRouteContribution(pluginId, route);
              if (normalized) {
                routeMap.set(`${pluginId}:${normalized.id}`, normalized);
              }
            }
          } catch (moduleError) {
            if (frontendEntry) {
              console.warn(`[plugin-runtime] Failed to load frontend module for ${pluginId}:`, moduleError);
            } else {
              console.warn(`[plugin-runtime] Failed to load builtin frontend module for ${pluginId}:`, moduleError);
            }
          }
        }

        const menuItems = Array.from(menuMap.values()).sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.title.localeCompare(b.title);
        });
        const routeItems = Array.from(routeMap.values()).sort((a, b) => {
          if (a.order !== b.order) return a.order - b.order;
          return a.path.localeCompare(b.path);
        });

        registerDocEditorBlockIdNodeTypes(Array.from(blockIdNodeTypes));

        setPlugins(runtimeItems);
        setCommands(runtimeCommands);
        setSidebarMenus(menuItems.filter((item) => item.placement === "sidebar"));
        setDocumentHeaderMenus(menuItems.filter((item) => item.placement === "document_header"));
        setRoutes(routeItems);
        setEditorContributions({
          extraExtensions,
          toolbarItems,
          blockIdNodeTypes: Array.from(blockIdNodeTypes),
        });
      } catch (runtimeError) {
        if (!cancelled) {
          const message = runtimeError instanceof Error ? runtimeError.message : "Failed to load plugin runtime";
          setError(message);
          setPlugins([]);
          setCommands([]);
          setSidebarMenus([]);
          setDocumentHeaderMenus([]);
          setRoutes([]);
          setEditorContributions({
            extraExtensions: [],
            toolbarItems: [],
            blockIdNodeTypes: [],
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadRuntime();

    return () => {
      cancelled = true;
    };
  }, [invokeOperation, executeCommand, refreshKey]);

  const value = useMemo<PluginRuntimeContextValue>(() => ({
    loading,
    error,
    plugins,
    commands,
    sidebarMenus,
    documentHeaderMenus,
    routes,
    editorContributions,
    refresh,
    runMenuAction,
    executeCommand,
    invokeOperation,
  }), [
    loading,
    error,
    plugins,
    commands,
    sidebarMenus,
    documentHeaderMenus,
    routes,
    editorContributions,
    refresh,
    runMenuAction,
    executeCommand,
    invokeOperation,
  ]);

  return (
    <PluginRuntimeContext.Provider value={value}>
      {children}
    </PluginRuntimeContext.Provider>
  );
}

function registerEditorBlockContribution(
  block: EditorBlockContribution,
  collector: {
    toolbarItems: ReactNode[];
    blockIdNodeTypes: Set<string>;
    extraExtensions: NonNullable<PluginEditorContributions["extraExtensions"]>;
  },
): void {
  const blockType = String(block.blockType || "").trim();
  if (blockType && block.requiresBlockId) {
    collector.blockIdNodeTypes.add(blockType);
  }

  const extension = (typeof block.extension === "function"
    ? block.extension()
    : block.extension) as Extensions[number] | undefined;
  if (extension) {
    collector.extraExtensions.push(extension);
  }

  const toolbarButton = (typeof block.toolbarButton === "function"
    ? block.toolbarButton()
    : block.toolbarButton) as ReactNode;
  if (toolbarButton) {
    collector.toolbarItems.push(toolbarButton);
  }
}

function normalizeMenuContribution(
  pluginId: string,
  menu: MenuContribution,
  pluginContext: Parameters<ZeusWebPlugin["register"]>[0],
  executeCommand: (
    commandId: string,
    input?: Record<string, unknown>,
    projectRefOverride?: string,
    source?: "api" | "palette" | "tool",
  ) => Promise<Record<string, unknown>>,
): PluginMenuEntry | null {
  const id = String(menu.id || "").trim();
  if (!id) {
    return null;
  }
  const placement = normalizeMenuPlacement(menu.placement);
  if (!placement) {
    return null;
  }

  const execute = typeof menu.onClick === "function"
    ? async () => {
      await menu.onClick?.(pluginContext);
    }
    : undefined;

  return {
    id,
    pluginId,
    title: String(menu.title || id).trim(),
    placement,
    order: Number.isFinite(Number(menu.order)) ? Number(menu.order) : 1000,
    icon: menu.icon || undefined,
    route: menu.route ? normalizeRoutePath(menu.route, pluginId, id) : undefined,
    action: menu.action || undefined,
    execute: execute
      || (menu.action
        ? async () => {
          await executeCommand(menu.action!, {}, undefined, "tool");
        }
        : undefined),
  };
}

function normalizeRouteContribution(
  pluginId: string,
  route: RouteContribution,
): PluginRouteEntry | null {
  const id = String(route.id || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    pluginId,
    title: route.title,
    path: normalizeRoutePath(route.path, pluginId, id),
    order: Number.isFinite(Number(route.order)) ? Number(route.order) : 1000,
    render: route.render
      ? () => route.render?.() as ReactNode
      : undefined,
  };
}

export function usePluginRuntime(): PluginRuntimeContextValue {
  const context = useContext(PluginRuntimeContext);
  if (!context) {
    throw new Error("usePluginRuntime must be used within PluginRuntimeProvider");
  }
  return context;
}
