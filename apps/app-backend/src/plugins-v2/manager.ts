import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { lookup as lookupMimeType } from "mime-types";
import type {
  PluginCommandV2,
  PluginDocHookEventV2,
  PluginDocHookStageV2,
  PluginManifestV2,
  PluginRegisteredCommandV2,
  PluginRuntimeItemV2,
  PluginStorePluginSummary,
  PluginStoreVersionV2,
} from "@zeus/plugin-sdk-shared";

import { pluginConfig, resolvePluginVersionDir } from "../plugins/config.js";
import { registerPluginBlockType } from "../plugins/block-registry.js";
import { PluginWorkerPool, type WorkerExecutionContext } from "../plugins/worker/worker-pool.js";
import { registerBlockIdNodeTypes } from "../utils/block-id.js";
import { documentStore, DocumentNotFoundError } from "../storage/document-store.js";
import type { Document } from "../storage/types.js";
import { assetStore } from "../storage/asset-store.js";
import {
  getUserPluginCacheRoot,
  getUserPluginDataGlobalRoot,
  getUserPluginRoot,
  getUserPluginRuntimeRoot,
  getUserPluginSettingsDir,
  getUserPluginTmpRoot,
} from "../storage/paths.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { documentSkills } from "../llm/skills/document-skills.js";
import { skillRegistry } from "../llm/skills/registry.js";
import { query } from "../db/postgres.js";
import {
  assertManifestIntegrityV2,
  parsePluginManifestV2,
  validatePluginManifestV2,
  verifyManifestSignatureV2,
} from "./manifest.js";
import { pluginStoreClientV2 } from "./store-client.js";
import { pluginInstallStoreV2 } from "./install-store.js";
import { pluginRegistrySnapshotStore } from "./registry-snapshot-store.js";
import type {
  ExecutePluginCommandInputV2,
  ExecutePluginOperationInputV2,
  HookDispatchInputV2,
  HookWorkerResultV2,
  InstalledPluginV2,
  PluginCommandRuntimeItemV2,
  PluginHookRuntimeItemV2,
} from "./types.js";
import { PluginCommandExecutorV2 } from "./command-executor.js";
import { HookOrchestratorV2 } from "./hook-orchestrator.js";

const execFileAsync = promisify(execFile);
const RESERVED_ROUTE_PREFIXES = ["/documents", "/chat", "/teams", "/login", "/register", "/plugins/store"];

function normalizePathInsidePlugin(relativePath: string): string {
  return relativePath
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function joinPluginPath(root: string, relativePath: string): string {
  const normalized = normalizePathInsidePlugin(relativePath);
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new Error("Invalid plugin path");
  }
  return resolved;
}

function isSafeTarPath(entryPath: string): boolean {
  if (!entryPath) return false;
  if (entryPath.includes("..")) return false;
  if (path.isAbsolute(entryPath)) return false;
  return true;
}

function wildcardHostMatch(allowedHost: string, currentHost: string): boolean {
  const normalizedAllowed = allowedHost.trim().toLowerCase();
  const normalizedCurrent = currentHost.trim().toLowerCase();
  if (!normalizedAllowed) return false;
  if (normalizedAllowed === normalizedCurrent) return true;
  if (normalizedAllowed.startsWith("*.")) {
    const suffix = normalizedAllowed.slice(2);
    return normalizedCurrent === suffix || normalizedCurrent.endsWith(`.${suffix}`);
  }
  return false;
}

function normalizeRoutePath(pluginId: string, routeId: string, pathRaw: string): string {
  const pathTrimmed = String(pathRaw || "").trim();
  if (!pathTrimmed) {
    return `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(routeId)}`;
  }
  const normalized = pathTrimmed.startsWith("/") ? pathTrimmed : `/${pathTrimmed}`;
  const requiredPrefix = `/plugins/${pluginId}/`;
  if (normalized.startsWith(requiredPrefix)) {
    return normalized;
  }
  const candidate = normalized.replace(/^\/+/, "");
  return `/plugins/${encodeURIComponent(pluginId)}/${candidate}`;
}

function toCommandRuntime(
  pluginId: string,
  version: string,
  command: PluginCommandV2,
): PluginCommandRuntimeItemV2 {
  return {
    pluginId,
    version,
    commandId: command.id,
    title: command.title,
    description: command.description,
    category: command.category,
    slashAliases: Array.from(new Set(command.slashAliases || [])),
    apiEnabled: command.apiEnabled !== false,
    requiresDocScope: command.requiresDocScope === true,
    handler: String(command.handler || command.id || "").trim() || command.id,
  };
}

function normalizeHookTimeoutMs(
  manifest: PluginManifestV2,
): number {
  const fromManifest = Number(manifest.permissions?.maxHookExecutionMs || 0);
  const fromExecution = Number(manifest.permissions?.maxExecutionMs || 0);
  const fallback = Number(pluginConfig.maxExecutionMs || 20000);
  const raw = fromManifest > 0 ? fromManifest : (fromExecution > 0 ? fromExecution : fallback);
  return Math.max(500, Math.min(fallback, Math.round(raw)));
}

function normalizeExecutionTimeoutMs(
  manifest: PluginManifestV2,
): number {
  const fromManifest = Number(manifest.permissions?.maxExecutionMs || 0);
  const fallback = Number(pluginConfig.maxExecutionMs || 20000);
  const raw = fromManifest > 0 ? fromManifest : fallback;
  return Math.max(500, Math.min(fallback, Math.round(raw)));
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

export class PluginManagerV2 {
  private readonly manifestCache = new Map<string, PluginManifestV2>();
  private readonly workerPool = new PluginWorkerPool(this.handleHostCall.bind(this));
  private readonly commandExecutor = new PluginCommandExecutorV2(
    this.resolveCommandForUser.bind(this),
    this.executeResolvedCommand.bind(this),
    pluginInstallStoreV2.appendAudit,
  );
  private readonly hookOrchestrator = new HookOrchestratorV2(
    this.listHooksForEvent.bind(this),
    this.executeHook.bind(this),
    pluginInstallStoreV2.appendAudit,
  );
  private readonly coreCommands = new Set(documentSkills.map((skill) => skill.command).filter(Boolean));

  async initialize(): Promise<void> {
    await mkdir(pluginConfig.rootDir, { recursive: true });
    await this.refreshInstalledBlockTypes();
  }

  async listStorePlugins(queryText: string): Promise<PluginStorePluginSummary[]> {
    const result = await pluginStoreClientV2.listPlugins(queryText);
    return result.plugins;
  }

  async listStorePluginVersions(pluginId: string): Promise<PluginStoreVersionV2[]> {
    return pluginStoreClientV2.getPluginVersions(pluginId);
  }

  async listUserPlugins(userId: string): Promise<InstalledPluginV2[]> {
    const installs = await pluginInstallStoreV2.listByUser(userId);
    const result: InstalledPluginV2[] = [];

    for (const install of installs) {
      if (install.status === "uninstalled") {
        continue;
      }
      const manifest = await this.loadManifestFromDisk(install.pluginId, install.version, userId);
      if (!manifest) continue;
      result.push({ installation: install, manifest });
    }

    return result;
  }

  async installPlugin(
    userId: string,
    pluginId: string,
    requestedVersion?: string,
  ): Promise<InstalledPluginV2> {
    await this.ensureUserPluginLayout(userId, pluginId);

    const versions = await pluginStoreClientV2.getPluginVersions(pluginId);
    if (versions.length === 0) {
      throw new Error(`Plugin not found in store: ${pluginId}`);
    }

    const selected = requestedVersion
      ? versions.find((item) => item.version === requestedVersion)
      : versions[0];

    if (!selected) {
      throw new Error(`Version not found: ${pluginId}@${requestedVersion}`);
    }

    await pluginInstallStoreV2.upsert(userId, pluginId, {
      version: selected.version,
      enabled: false,
      status: "installing",
      manifestApiVersion: 2,
      capabilities: [],
      activation: {},
    });

    const startedAt = Date.now();
    let tempExtractDir: string | null = null;
    try {
      const packageBuffer = await pluginStoreClientV2.downloadPackage(pluginId, selected.version);
      const extracted = await this.extractToTemporaryRoot(pluginId, selected.version, packageBuffer);
      tempExtractDir = extracted.tmpDir;
      const extractedRoot = extracted.packageRoot;

      const manifest = await this.readManifestFromExtractedRoot(extractedRoot);
      if (manifest.id !== pluginId || manifest.version !== selected.version) {
        throw new Error(`Manifest mismatch: expected ${pluginId}@${selected.version}`);
      }

      const digest = createHash("sha256").update(packageBuffer).digest("hex");
      verifyManifestSignatureV2(
        manifest,
        digest,
        pluginConfig.signaturePublicKeyPem,
        pluginConfig.requireSignature,
      );
      assertManifestIntegrityV2(manifest, packageBuffer);

      validatePluginManifestV2(manifest, {
        appBackend: pluginConfig.appBackendVersion,
        web: pluginConfig.webVersion,
      });

      await this.assertContributionConflicts(userId, pluginId, manifest);

      const versionDir = resolvePluginVersionDir(pluginId, selected.version, userId);
      await rm(versionDir, { recursive: true, force: true });
      await mkdir(path.dirname(versionDir), { recursive: true });
      await cp(extractedRoot, versionDir, { recursive: true, force: true });

      this.manifestCache.set(`${pluginId}@${selected.version}`, manifest);
      this.registerManifestBlockTypes(manifest);

      const installation = await pluginInstallStoreV2.upsert(userId, pluginId, {
        version: selected.version,
        enabled: true,
        status: "installed",
        lastError: null,
        manifestApiVersion: 2,
        capabilities: manifest.capabilities,
        activation: manifest.activation,
      });

      await this.refreshSnapshotForPlugin(userId, manifest);

      await pluginInstallStoreV2.appendAudit({
        userId,
        pluginId,
        operationId: "install",
        projectScope: "global",
        status: "ok",
        durationMs: Date.now() - startedAt,
        eventType: "install",
      });

      return { installation, manifest };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await pluginInstallStoreV2.upsert(userId, pluginId, {
        version: selected.version,
        enabled: false,
        status: "failed",
        lastError: message,
        manifestApiVersion: 2,
        capabilities: [],
        activation: {},
      });

      await pluginInstallStoreV2.appendAudit({
        userId,
        pluginId,
        operationId: "install",
        projectScope: "global",
        status: "error",
        durationMs: Date.now() - startedAt,
        error: message,
        eventType: "install",
      });
      throw err;
    } finally {
      if (tempExtractDir) {
        await rm(tempExtractDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  async setPluginEnabled(
    userId: string,
    pluginId: string,
    enabled: boolean,
  ): Promise<InstalledPluginV2["installation"]> {
    const installation = await pluginInstallStoreV2.get(userId, pluginId);
    if (!installation || installation.status !== "installed") {
      throw new Error(`Plugin is not installed: ${pluginId}`);
    }

    const updated = await pluginInstallStoreV2.updateEnabled(userId, pluginId, enabled);
    if (!updated) {
      throw new Error(`Plugin is not installed: ${pluginId}`);
    }

    await pluginInstallStoreV2.appendAudit({
      userId,
      pluginId,
      operationId: enabled ? "enable" : "disable",
      projectScope: "global",
      status: "ok",
      durationMs: 0,
      eventType: enabled ? "enable" : "disable",
    });

    if (enabled) {
      const manifest = await this.loadManifestFromDisk(pluginId, updated.version, userId);
      if (manifest) {
        await this.refreshSnapshotForPlugin(userId, manifest);
      }
    }

    return updated;
  }

  async uninstallPlugin(userId: string, pluginId: string): Promise<boolean> {
    const removed = await pluginInstallStoreV2.remove(userId, pluginId);
    await pluginRegistrySnapshotStore.remove(userId, pluginId);
    await pluginInstallStoreV2.appendAudit({
      userId,
      pluginId,
      operationId: "uninstall",
      projectScope: "global",
      status: removed ? "ok" : "not_found",
      durationMs: 0,
      eventType: "uninstall",
    });
    return removed;
  }

  async getPluginSettings(userId: string, pluginId: string): Promise<Record<string, unknown>> {
    return (await pluginInstallStoreV2.getSettings(userId, pluginId)) || {};
  }

  async setPluginSettings(
    userId: string,
    pluginId: string,
    settings: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const installation = await pluginInstallStoreV2.get(userId, pluginId);
    if (!installation || installation.status !== "installed") {
      throw new Error(`Plugin is not installed: ${pluginId}`);
    }
    await this.ensureUserPluginLayout(userId, pluginId);
    return pluginInstallStoreV2.setSettings(userId, pluginId, settings);
  }

  async getRuntimeForUser(userId: string): Promise<PluginRuntimeItemV2[]> {
    const plugins = await this.listUserPlugins(userId);
    const items: PluginRuntimeItemV2[] = [];

    for (const plugin of plugins) {
      if (plugin.installation.status !== "installed" || !plugin.installation.enabled) {
        continue;
      }

      const frontendEntryUrl = plugin.manifest.frontend?.entry
        ? this.buildFrontendEntryUrl(plugin.manifest.id, plugin.manifest.version, plugin.manifest.frontend.entry)
        : undefined;

      const routes = (plugin.manifest.contributes.routes || []).map((route) => ({
        ...route,
        path: normalizeRoutePath(plugin.manifest.id, route.id, route.path),
      }));

      items.push({
        pluginId: plugin.manifest.id,
        version: plugin.manifest.version,
        displayName: plugin.manifest.displayName,
        frontendEntryUrl,
        capabilities: plugin.manifest.capabilities,
        activation: plugin.manifest.activation,
        contributes: {
          ...plugin.manifest.contributes,
          routes,
        },
      });
    }

    return items.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  async getCommandsForUser(userId: string): Promise<PluginCommandRuntimeItemV2[]> {
    const installations = await pluginInstallStoreV2.listByUser(userId);
    const enabled = new Map(
      installations
        .filter((item) => item.status === "installed" && item.enabled)
        .map((item) => [`${item.pluginId}@${item.version}`, item]),
    );
    if (enabled.size === 0) {
      return [];
    }

    const snapshots = await pluginRegistrySnapshotStore.listByUser(userId);
    const commands: PluginCommandRuntimeItemV2[] = [];
    const seenPluginVersions = new Set<string>();

    for (const snapshot of snapshots) {
      const key = `${snapshot.pluginId}@${snapshot.version}`;
      if (!enabled.has(key)) {
        continue;
      }
      seenPluginVersions.add(key);
      for (const command of snapshot.commands || []) {
        commands.push({
          ...command,
          slashAliases: Array.from(new Set((command.slashAliases || []).map((alias) => alias.trim()).filter(Boolean))),
          apiEnabled: command.apiEnabled !== false,
          requiresDocScope: command.requiresDocScope === true,
          handler: String(command.handler || command.commandId || "").trim() || command.commandId,
        });
      }
    }

    for (const [key, install] of enabled) {
      if (seenPluginVersions.has(key)) {
        continue;
      }
      const manifest = await this.loadManifestFromDisk(install.pluginId, install.version, userId);
      if (!manifest) continue;
      const pluginCommands = (manifest.contributes.commands || [])
        .map((command) => toCommandRuntime(manifest.id, manifest.version, command));
      commands.push(...pluginCommands);
      await this.refreshSnapshotForPlugin(userId, manifest);
    }

    return commands.sort((a, b) => {
      const left = a.commandId;
      const right = b.commandId;
      if (left !== right) return left.localeCompare(right);
      return a.pluginId.localeCompare(b.pluginId);
    });
  }

  async listEnabledCommandsForUser(userId: string): Promise<PluginCommandRuntimeItemV2[]> {
    return this.getCommandsForUser(userId);
  }

  async listEnabledSlashCommandsForUser(userId: string): Promise<string[]> {
    const commands = await this.getCommandsForUser(userId);
    const merged = new Set<string>();
    for (const command of commands) {
      for (const alias of command.slashAliases || []) {
        merged.add(alias);
      }
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }

  async executeCommand(input: ExecutePluginCommandInputV2): Promise<Record<string, unknown>> {
    return this.commandExecutor.execute({
      userId: input.userId,
      projectKey: input.projectKey,
      commandId: input.commandId,
      args: input.args,
      source: input.source,
      requestId: input.requestId,
    });
  }

  async executeOperation(input: ExecutePluginOperationInputV2): Promise<Record<string, unknown>> {
    const normalizedOperationId = String(input.operationId || "").trim();
    if (!normalizedOperationId) {
      throw new Error("operationId is required");
    }

    const installation = await pluginInstallStoreV2.get(input.userId, input.pluginId);
    if (!installation || installation.status !== "installed" || !installation.enabled) {
      throw new Error(`Plugin is not installed or disabled: ${input.pluginId}`);
    }

    const manifest = await this.getManifestOrThrow(input.pluginId, installation.version, input.userId);
    const backendEntry = manifest.backend?.entry;
    if (!backendEntry) {
      throw new Error(`Plugin ${manifest.id} does not provide backend entry`);
    }

    const handler = normalizedOperationId;
    return this.executeBackendHandler({
      manifest,
      backendEntry,
      handler,
      userId: input.userId,
      input: input.args || {},
      context: {
        userId: input.userId,
        projectKey: input.projectKey,
      },
      timeoutMs: normalizeExecutionTimeoutMs(manifest),
    });
  }

  async runBeforeHooks(input: HookDispatchInputV2) {
    return this.hookOrchestrator.runBefore(input);
  }

  dispatchAfterHooks(input: HookDispatchInputV2): void {
    this.hookOrchestrator.dispatchAfter(input);
  }

  async getRuntimeCommandsForUser(userId: string): Promise<PluginCommandRuntimeItemV2[]> {
    return this.getCommandsForUser(userId);
  }

  async resolveAssetPathForUser(
    userId: string,
    pluginId: string,
    version: string,
    relativePath: string,
  ): Promise<{ path: string; mime: string }> {
    const installation = await pluginInstallStoreV2.get(userId, pluginId);
    if (!installation || installation.status !== "installed" || !installation.enabled) {
      throw new Error(`Plugin is not available: ${pluginId}`);
    }
    if (installation.version !== version) {
      throw new Error(`Plugin version mismatch: ${pluginId}`);
    }

    const versionDir = resolvePluginVersionDir(pluginId, version, userId);
    const absolutePath = joinPluginPath(versionDir, relativePath);
    await access(absolutePath);

    const fileStats = await stat(absolutePath);
    if (!fileStats.isFile()) {
      throw new Error("Plugin asset is not a file");
    }

    const mime = String(lookupMimeType(absolutePath) || "application/octet-stream");
    return { path: absolutePath, mime };
  }

  async readAsset(
    userId: string,
    pluginId: string,
    version: string,
    relativePath: string,
  ): Promise<{ content: Buffer; mime: string; absolutePath: string }> {
    const resolved = await this.resolveAssetPathForUser(userId, pluginId, version, relativePath);
    return {
      content: await readFile(resolved.path),
      mime: resolved.mime,
      absolutePath: resolved.path,
    };
  }

  async listHooksForEvent(
    userId: string,
    event: PluginDocHookEventV2,
    stage: PluginDocHookStageV2,
  ): Promise<PluginHookRuntimeItemV2[]> {
    const plugins = await this.listUserPlugins(userId);
    const hooks: PluginHookRuntimeItemV2[] = [];

    for (const plugin of plugins) {
      if (plugin.installation.status !== "installed" || !plugin.installation.enabled) {
        continue;
      }

      const capability = stage === "before" ? "docs.hook.before" : "docs.hook.after";
      if (!plugin.manifest.capabilities.includes(capability)) {
        continue;
      }

      const backendEntry = plugin.manifest.backend?.entry;
      if (!backendEntry) {
        continue;
      }

      for (const hook of plugin.manifest.contributes.docHooks || []) {
        if (hook.stage !== stage || hook.event !== event) {
          continue;
        }
        hooks.push({
          ...hook,
          pluginId: plugin.manifest.id,
          version: plugin.manifest.version,
          handler: String(hook.handler || hook.id || "").trim() || hook.id,
          permissions: {
            allowedHttpHosts: plugin.manifest.permissions?.allowedHttpHosts || [],
            maxExecutionMs: normalizeExecutionTimeoutMs(plugin.manifest),
            maxHookExecutionMs: normalizeHookTimeoutMs(plugin.manifest),
          },
        });
      }
    }

    return hooks;
  }

  dispose(): void {
    this.workerPool.dispose();
  }

  private async resolveCommandForUser(
    userId: string,
    commandIdOrAlias: string,
  ): Promise<PluginCommandRuntimeItemV2 | null> {
    const normalized = String(commandIdOrAlias || "").trim();
    if (!normalized) return null;

    const commands = await this.getCommandsForUser(userId);
    for (const command of commands) {
      if (command.commandId === normalized) {
        return command;
      }
      if ((command.slashAliases || []).includes(normalized)) {
        return command;
      }
    }
    return null;
  }

  private async executeResolvedCommand(
    command: PluginCommandRuntimeItemV2,
    input: {
      userId: string;
      projectKey: string;
      args: Record<string, unknown>;
      source: "api" | "slash" | "palette" | "tool" | "hook";
      requestId?: string;
    },
  ): Promise<Record<string, unknown>> {
    const manifest = await this.getManifestOrThrow(command.pluginId, command.version, input.userId);
    if (!manifest.capabilities.includes("system.command.register")) {
      throw new Error(`Plugin ${manifest.id} does not have system.command.register capability`);
    }

    const backendEntry = manifest.backend?.entry;
    if (!backendEntry) {
      throw new Error(`Plugin ${manifest.id} does not provide backend entry`);
    }

    return this.executeBackendHandler({
      manifest,
      backendEntry,
      handler: command.handler || command.commandId,
      userId: input.userId,
      input: {
        ...input.args,
        __command_id: command.commandId,
        __source: input.source,
        __request_id: input.requestId || null,
      },
      context: {
        userId: input.userId,
        projectKey: input.projectKey,
      },
      timeoutMs: normalizeExecutionTimeoutMs(manifest),
    });
  }

  private async executeHook(
    hook: PluginHookRuntimeItemV2,
    input: {
      userId: string;
      projectKey: string;
      payload: Record<string, unknown>;
    },
  ): Promise<HookWorkerResultV2> {
    const manifest = await this.getManifestOrThrow(hook.pluginId, hook.version, input.userId);
    const backendEntry = manifest.backend?.entry;
    if (!backendEntry) {
      throw new Error(`Plugin ${manifest.id} does not provide backend entry`);
    }

    const stageCapability = hook.stage === "before" ? "docs.hook.before" : "docs.hook.after";
    if (!manifest.capabilities.includes(stageCapability)) {
      throw new Error(`Plugin ${manifest.id} does not have ${stageCapability} capability`);
    }

    return this.executeBackendHandler({
      manifest,
      backendEntry,
      handler: hook.handler || hook.id,
      userId: input.userId,
      input: {
        ...input.payload,
        __hook_id: hook.id,
        __hook_event: hook.event,
        __hook_stage: hook.stage,
      },
      context: {
        userId: input.userId,
        projectKey: input.projectKey,
      },
      timeoutMs: hook.permissions.maxHookExecutionMs || normalizeHookTimeoutMs(manifest),
    });
  }

  private async executeBackendHandler(input: {
    manifest: PluginManifestV2;
    backendEntry: string;
    handler: string;
    userId: string;
    input: Record<string, unknown>;
    context: {
      userId: string;
      projectKey: string;
    };
    timeoutMs: number;
  }): Promise<Record<string, unknown>> {
    const versionDir = resolvePluginVersionDir(input.manifest.id, input.manifest.version, input.userId);
    const backendPath = joinPluginPath(versionDir, input.backendEntry);
    await access(backendPath);

    const executionContext: WorkerExecutionContext = {
      pluginId: input.manifest.id,
      userId: input.context.userId,
      projectKey: input.context.projectKey,
      permissions: {
        allowedHttpHosts: input.manifest.permissions?.allowedHttpHosts || [],
        maxExecutionMs: normalizeExecutionTimeoutMs(input.manifest),
      },
      capabilities: input.manifest.capabilities,
    };

    const result = await this.workerPool.execute(
      input.manifest.id,
      input.manifest.version,
      backendPath,
      input.handler,
      input.input,
      executionContext,
      Math.max(200, Math.round(input.timeoutMs || normalizeExecutionTimeoutMs(input.manifest))),
    );

    return result;
  }

  private async handleHostCall(
    context: WorkerExecutionContext,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const methodName = String(method || "").trim();

    switch (methodName) {
      case "getDocument": {
        this.assertCapability(context, "docs.read", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const docId = String(args.docId || "").trim();
        if (!docId) throw new Error("docId is required");
        try {
          const doc = await documentStore.get(context.userId, projectKey, docId);
          return { meta: doc.meta, body: doc.body };
        } catch (err) {
          if (err instanceof DocumentNotFoundError) {
            return null;
          }
          throw err;
        }
      }

      case "listDocuments": {
        this.assertCapability(context, "docs.read", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const parentId = String(args.parentId || "root").trim() || "root";
        return documentStore.getChildren(context.userId, projectKey, parentId);
      }

      case "createDocument": {
        this.assertCapability(context, "docs.write", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const doc = args.doc && typeof args.doc === "object"
          ? args.doc as Document
          : null;
        if (!doc) {
          throw new Error("doc is required");
        }
        const saved = await documentStore.save(context.userId, projectKey, doc);
        return { meta: saved.meta, body: saved.body };
      }

      case "updateDocument":
      case "saveDocument": {
        this.assertCapability(context, "docs.write", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const doc = args.doc && typeof args.doc === "object"
          ? args.doc as Document
          : null;
        if (!doc) {
          throw new Error("doc is required");
        }
        const saved = await documentStore.save(context.userId, projectKey, doc);
        return { meta: saved.meta, body: saved.body };
      }

      case "moveDocument": {
        this.assertCapability(context, "docs.write", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const docId = String(args.docId || "").trim();
        const targetParentId = String(args.targetParentId || "root").trim() || "root";
        const beforeDocId = typeof args.beforeDocId === "string" ? args.beforeDocId : undefined;
        const afterDocId = typeof args.afterDocId === "string" ? args.afterDocId : undefined;
        if (!docId) {
          throw new Error("docId is required");
        }
        await documentStore.move(
          context.userId,
          projectKey,
          docId,
          targetParentId,
          beforeDocId,
          afterDocId,
        );
        return { ok: true };
      }

      case "deleteDocument": {
        this.assertCapability(context, "docs.write", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const docId = String(args.docId || "").trim();
        const recursive = args.recursive === true;
        if (!docId) {
          throw new Error("docId is required");
        }
        const deletedIds = await documentStore.delete(context.userId, projectKey, docId, recursive);
        return { deletedIds };
      }

      case "getAssetMeta": {
        this.assertCapability(context, "docs.read", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const assetId = String(args.assetId || "").trim();
        if (!assetId) throw new Error("assetId is required");
        return await assetStore.getMeta(context.userId, projectKey, assetId);
      }

      case "searchKnowledge":
      case "getKnowledgeSources": {
        this.assertCapability(context, "docs.read", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const queryText = String(args.query || "").trim();
        const limit = Math.min(Math.max(1, Number(args.limit || 8)), 50);
        if (!queryText) return { results: [] };
        return knowledgeSearch.search(context.userId, projectKey, {
          mode: "hybrid",
          text: queryText,
          limit,
        });
      }

      case "fetchUrl": {
        const rawUrl = String(args.url || "").trim();
        if (!rawUrl) throw new Error("url is required");
        this.assertHostAllowed(context.permissions.allowedHttpHosts || [], rawUrl);

        const response = await fetch(rawUrl, {
          method: "GET",
          signal: AbortSignal.timeout(context.permissions.maxExecutionMs || pluginConfig.maxExecutionMs),
        });
        const body = await response.text();
        return {
          url: rawUrl,
          status: response.status,
          ok: response.ok,
          body: body.slice(0, 300000),
          headers: Object.fromEntries(response.headers.entries()),
        };
      }

      default:
        throw new Error(`Unsupported host method: ${methodName}`);
    }
  }

  private assertCapability(
    context: WorkerExecutionContext,
    capability: string,
    methodName: string,
  ): void {
    const capabilities = normalizeCapabilities(context.capabilities);
    if (!capabilities.includes(capability)) {
      throw new Error(`Capability ${capability} is required for host method ${methodName}`);
    }
  }

  private assertHostAllowed(allowedHosts: string[], targetUrl: string): void {
    if (!allowedHosts || allowedHosts.length === 0) {
      throw new Error("Plugin network access is denied by policy");
    }

    let host = "";
    try {
      host = new URL(targetUrl).host;
    } catch {
      throw new Error("Invalid URL");
    }

    const matched = allowedHosts.some((allowed) => wildcardHostMatch(allowed, host));
    if (!matched) {
      throw new Error(`HTTP host is not allowed by plugin policy: ${host}`);
    }
  }

  private async refreshInstalledBlockTypes(): Promise<void> {
    try {
      await access(pluginConfig.rootDir);
    } catch {
      return;
    }

    const installs = await pluginInstallStoreV2.listEnabled();
    for (const install of installs) {
      const manifest = await this.loadManifestFromDisk(install.pluginId, install.version, install.userId);
      if (!manifest) continue;
      this.registerManifestBlockTypes(manifest);
    }
  }

  private registerManifestBlockTypes(manifest: PluginManifestV2): void {
    for (const block of manifest.contributes.blocks || []) {
      registerPluginBlockType(block.blockType, {
        requiresBlockId: block.requiresBlockId,
      });
    }

    const blockIdTypes = (manifest.contributes.blocks || [])
      .filter((item) => item.requiresBlockId)
      .map((item) => item.blockType);
    registerBlockIdNodeTypes(blockIdTypes);
  }

  private async refreshSnapshotForPlugin(userId: string, manifest: PluginManifestV2): Promise<void> {
    const commands = (manifest.contributes.commands || []).map((item) => toCommandRuntime(manifest.id, manifest.version, item));
    const hooks = (manifest.contributes.docHooks || []).map((item) => ({
      ...item,
      pluginId: manifest.id,
      version: manifest.version,
      handler: String(item.handler || item.id || "").trim() || item.id,
    }));
    const routes = (manifest.contributes.routes || []).map((route) => ({
      ...route,
      path: normalizeRoutePath(manifest.id, route.id, route.path),
    }));
    const tools = (manifest.contributes.docTools || []).map((tool) => ({ ...tool }));

    await pluginRegistrySnapshotStore.upsert({
      userId,
      pluginId: manifest.id,
      version: manifest.version,
      commands,
      hooks,
      routes,
      tools,
    });
  }

  private async assertContributionConflicts(
    userId: string,
    pluginId: string,
    manifest: PluginManifestV2,
  ): Promise<void> {
    const nextCommandIds = new Set((manifest.contributes.commands || []).map((item) => item.id));
    const nextSlashAliases = new Set<string>();
    for (const command of manifest.contributes.commands || []) {
      for (const alias of command.slashAliases || []) {
        nextSlashAliases.add(alias);
      }
    }

    const nextRoutes = new Set(
      (manifest.contributes.routes || []).map((route) => normalizeRoutePath(manifest.id, route.id, route.path)),
    );

    for (const route of nextRoutes) {
      for (const reservedPrefix of RESERVED_ROUTE_PREFIXES) {
        if (route === reservedPrefix || route.startsWith(`${reservedPrefix}/`)) {
          throw new Error(`Plugin route conflicts with core route namespace: ${route}`);
        }
      }
    }

    const reservedSlash = new Set<string>(this.coreCommands);
    for (const skill of skillRegistry.getAllAnthropic()) {
      const command = String(skill.triggers.command || "").trim();
      if (command) reservedSlash.add(command);
    }

    for (const alias of nextSlashAliases) {
      if (reservedSlash.has(alias)) {
        throw new Error(`Plugin command conflicts with built-in command: ${alias}`);
      }
    }

    const installed = await this.listUserPlugins(userId);
    for (const installedPlugin of installed) {
      if (installedPlugin.manifest.id === pluginId) {
        continue;
      }

      for (const command of installedPlugin.manifest.contributes.commands || []) {
        if (nextCommandIds.has(command.id)) {
          throw new Error(`Plugin command id conflicts with ${installedPlugin.manifest.id}: ${command.id}`);
        }

        for (const alias of command.slashAliases || []) {
          if (nextSlashAliases.has(alias)) {
            throw new Error(`Plugin slash alias conflicts with ${installedPlugin.manifest.id}: ${alias}`);
          }
        }
      }

      for (const route of installedPlugin.manifest.contributes.routes || []) {
        const normalized = normalizeRoutePath(installedPlugin.manifest.id, route.id, route.path);
        if (nextRoutes.has(normalized)) {
          throw new Error(`Plugin route conflicts with ${installedPlugin.manifest.id}: ${normalized}`);
        }
      }
    }
  }

  private async extractToTemporaryRoot(
    pluginId: string,
    version: string,
    packageBuffer: Buffer,
  ): Promise<{ tmpDir: string; packageRoot: string }> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zeus-plugin-v2-"));
    const tgzPath = path.join(tmpDir, `${pluginId}-${version}.tgz`);
    const extractDir = path.join(tmpDir, "extract");
    await mkdir(extractDir, { recursive: true });
    await writeFile(tgzPath, packageBuffer);

    const listResult = await execFileAsync("tar", ["-tzf", tgzPath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    const entries = listResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (entries.length === 0) {
      throw new Error("Plugin package archive is empty");
    }

    for (const entryPath of entries) {
      if (!isSafeTarPath(entryPath)) {
        throw new Error(`Unsafe path in plugin package: ${entryPath}`);
      }
    }

    await execFileAsync("tar", ["-xzf", tgzPath, "-C", extractDir], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    const packageRoot = await this.resolveExtractedPackageRoot(extractDir);
    return { tmpDir, packageRoot };
  }

  private async resolveExtractedPackageRoot(extractDir: string): Promise<string> {
    const candidates = [
      path.join(extractDir, "manifest.v2.json"),
      path.join(extractDir, "manifest.json"),
      path.join(extractDir, "package", "manifest.v2.json"),
      path.join(extractDir, "package", "manifest.json"),
    ];

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return path.dirname(candidate);
      } catch {
        // continue
      }
    }

    throw new Error("Plugin package is missing manifest.v2.json or manifest.json");
  }

  private async readManifestFromExtractedRoot(extractedRoot: string): Promise<PluginManifestV2> {
    const v2Path = path.join(extractedRoot, "manifest.v2.json");
    try {
      const raw = JSON.parse(await readFile(v2Path, "utf8")) as unknown;
      return parsePluginManifestV2(raw);
    } catch {
      // fall through to manifest.json
    }

    const pathV1Name = path.join(extractedRoot, "manifest.json");
    const raw = JSON.parse(await readFile(pathV1Name, "utf8")) as unknown;
    return parsePluginManifestV2(raw);
  }

  private buildFrontendEntryUrl(pluginId: string, version: string, entry: string): string {
    const normalized = normalizePathInsidePlugin(entry);
    const encodedEntry = normalized
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `/api/plugins/v2/assets/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/${encodedEntry}`;
  }

  private async getManifestOrThrow(pluginId: string, version: string, userId?: string): Promise<PluginManifestV2> {
    const manifest = await this.loadManifestFromDisk(pluginId, version, userId);
    if (!manifest) {
      throw new Error(`Manifest not found: ${pluginId}@${version}`);
    }
    return manifest;
  }

  private async loadManifestFromDisk(pluginId: string, version: string, userId?: string): Promise<PluginManifestV2 | null> {
    const key = `${pluginId}@${version}`;
    const cached = this.manifestCache.get(key);
    if (cached) {
      return cached;
    }

    const versionDirs = userId
      ? [resolvePluginVersionDir(pluginId, version, userId), resolvePluginVersionDir(pluginId, version)]
      : [resolvePluginVersionDir(pluginId, version)];
    const candidates: string[] = [];
    for (const versionDir of versionDirs) {
      candidates.push(path.join(versionDir, "manifest.v2.json"));
      candidates.push(path.join(versionDir, "manifest.json"));
    }

    for (const manifestPath of candidates) {
      try {
        const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
        const manifest = parsePluginManifestV2(raw);
        validatePluginManifestV2(manifest, {
          appBackend: pluginConfig.appBackendVersion,
          web: pluginConfig.webVersion,
        });
        this.manifestCache.set(key, manifest);
        return manifest;
      } catch {
        // continue
      }
    }

    return null;
  }

  private async ensureManifestFromDisk(pluginId: string, version: string): Promise<void> {
    const key = `${pluginId}@${version}`;
    if (this.manifestCache.has(key)) return;

    const versionDir = resolvePluginVersionDir(pluginId, version);
    try {
      const items = await readdir(versionDir);
      if (items.length === 0) {
        this.manifestCache.delete(key);
      }
    } catch {
      this.manifestCache.delete(key);
    }
  }

  private async ensureUserPluginLayout(userId: string, pluginId: string): Promise<void> {
    await mkdir(getUserPluginRoot(userId), { recursive: true });
    await mkdir(getUserPluginSettingsDir(userId), { recursive: true });
    await mkdir(getUserPluginDataGlobalRoot(userId, pluginId), { recursive: true });
    await mkdir(getUserPluginCacheRoot(userId, pluginId), { recursive: true });
    await mkdir(getUserPluginRuntimeRoot(userId), { recursive: true });
    await mkdir(getUserPluginTmpRoot(userId), { recursive: true });
  }
}

export const pluginManagerV2 = new PluginManagerV2();
