import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
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
  PluginSettingsField,
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
  getUserPluginDataProjectRoot,
  getUserPluginRoot,
  getUserPluginRuntimeRoot,
  getUserPluginSettingsDir,
  getUserPluginTmpRoot,
} from "../storage/paths.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { documentSkills } from "../llm/skills/document-skills.js";
import { skillRegistry } from "../llm/skills/registry.js";
import { query } from "../db/postgres.js";
import { traceManager, isLangfuseEnabled, type SpanContext, type TraceContext } from "../observability/index.js";
import {
  assertManifestIntegrityV2,
  parsePluginManifestV2,
  validatePluginManifestV2,
  verifyManifestSignatureV2,
} from "./manifest.js";
import type { LangfuseGenerationClient } from "langfuse";
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
const MAX_PLUGIN_LOCAL_DATA_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PLUGIN_LOCAL_DATA_LIST_LIMIT = 500;
const PPT_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type PluginLocalDataScope = "project" | "global";
type PluginLocalDataEncoding = "utf8" | "base64";

export type PluginLocalDataEntry = {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
  updatedAt?: string;
};

export type PluginLocalDataFile = {
  path: string;
  content: string;
  encoding: PluginLocalDataEncoding;
  size: number;
  updatedAt: string;
};

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectSettingsDefaults(manifest: PluginManifestV2): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const fields = manifest.settings?.fields || [];
  for (const field of fields) {
    if (field.default !== undefined) {
      defaults[field.key] = field.default;
    }
  }
  return defaults;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function normalizeSettingFieldValue(
  manifest: PluginManifestV2,
  field: PluginSettingsField,
  rawValue: unknown,
): string | number | boolean {
  if (field.type === "boolean") {
    const boolValue = normalizeBoolean(rawValue);
    if (boolValue === undefined) {
      throw new Error(`Plugin ${manifest.id} settings field ${field.key} requires boolean`);
    }
    return boolValue;
  }

  if (field.type === "number") {
    const numberValue = normalizeNumber(rawValue);
    if (numberValue === undefined) {
      throw new Error(`Plugin ${manifest.id} settings field ${field.key} requires number`);
    }
    if (field.min !== undefined && numberValue < field.min) {
      throw new Error(`Plugin ${manifest.id} settings field ${field.key} must be >= ${field.min}`);
    }
    if (field.max !== undefined && numberValue > field.max) {
      throw new Error(`Plugin ${manifest.id} settings field ${field.key} must be <= ${field.max}`);
    }
    return numberValue;
  }

  const textValue = normalizeStringValue(rawValue);
  if (textValue === undefined) {
    throw new Error(`Plugin ${manifest.id} settings field ${field.key} requires string`);
  }

  if (field.type === "select") {
    const options = Array.isArray(field.options) ? field.options : [];
    if (!options.some((option) => option.value === textValue)) {
      throw new Error(`Plugin ${manifest.id} settings field ${field.key} has invalid option value`);
    }
  }

  return textValue;
}

function normalizePluginLocalDataScope(value: unknown): PluginLocalDataScope {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "global" ? "global" : "project";
}

function normalizePluginLocalDataEncoding(value: unknown): PluginLocalDataEncoding {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "base64" ? "base64" : "utf8";
}

function normalizePluginLocalDataRelativePath(
  value: unknown,
  options?: { allowEmpty?: boolean },
): string {
  const normalized = normalizePathInsidePlugin(String(value || ""));
  if (!normalized && options?.allowEmpty !== true) {
    throw new Error("path is required");
  }
  return normalized;
}

function normalizePluginLocalDataLimit(value: unknown): number {
  const parsed = Math.floor(Number(value || 200));
  if (!Number.isFinite(parsed)) {
    return 200;
  }
  return Math.min(Math.max(parsed, 1), MAX_PLUGIN_LOCAL_DATA_LIST_LIMIT);
}

export class PluginManagerV2 {
  private readonly manifestCache = new Map<
    string,
    {
      manifest: PluginManifestV2;
      manifestPath: string;
      mtimeMs: number;
    }
  >();
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
  private readonly pluginTraceSpans = new Map<string, SpanContext>();
  private readonly pluginTraceGenerations = new Map<string, {
    generation: LangfuseGenerationClient;
    traceId: string;
    ownsTrace: boolean;
  }>();
  private readonly pluginTraceOwners = new Map<string, { count: number }>();
  private traceHandleSeq = 0;

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

      this.manifestCache.delete(this.getManifestCacheKey(pluginId, selected.version, userId));
      this.manifestCache.delete(this.getManifestCacheKey(pluginId, selected.version));
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
    const manifest = await this.getInstalledManifest(userId, pluginId);
    const stored = (await pluginInstallStoreV2.getSettings(userId, pluginId)) || {};
    return this.normalizePluginSettings(manifest, stored, { strictRequired: false });
  }

  async setPluginSettings(
    userId: string,
    pluginId: string,
    settings: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const manifest = await this.getInstalledManifest(userId, pluginId);
    const current = await this.getPluginSettings(userId, pluginId);
    const merged = {
      ...current,
      ...(isObjectRecord(settings) ? settings : {}),
    };
    const normalized = this.normalizePluginSettings(manifest, merged, { strictRequired: true });
    await this.ensureUserPluginLayout(userId, pluginId);
    return pluginInstallStoreV2.setSettings(userId, pluginId, normalized);
  }

  async listLocalDataFiles(input: {
    userId: string;
    projectKey: string;
    pluginId: string;
    scope?: PluginLocalDataScope;
    dir?: string;
    limit?: number;
  }): Promise<PluginLocalDataEntry[]> {
    const root = await this.resolvePluginLocalDataRoot({
      userId: input.userId,
      projectKey: input.projectKey,
      pluginId: input.pluginId,
      scope: input.scope,
    });
    const relativeDir = normalizePluginLocalDataRelativePath(input.dir, { allowEmpty: true });
    const absoluteDir = relativeDir ? joinPluginPath(root, relativeDir) : root;
    const limit = normalizePluginLocalDataLimit(input.limit);

    let dirEntries: Dirent[] = [];
    try {
      dirEntries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (err: unknown) {
      const code = typeof err === "object" && err && "code" in err
        ? String((err as { code?: unknown }).code || "")
        : "";
      if (code === "ENOENT") {
        return [];
      }
      throw err;
    }

    const sortedEntries = [...dirEntries].sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const result: PluginLocalDataEntry[] = [];
    for (const entry of sortedEntries) {
      if (result.length >= limit) {
        break;
      }
      if (!entry.isDirectory() && !entry.isFile()) {
        continue;
      }
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        result.push({
          path: relativePath,
          name: entry.name,
          type: "directory",
        });
        continue;
      }
      const absolutePath = joinPluginPath(root, relativePath);
      const fileMeta = await stat(absolutePath);
      result.push({
        path: relativePath,
        name: entry.name,
        type: "file",
        size: fileMeta.size,
        updatedAt: fileMeta.mtime.toISOString(),
      });
    }

    return result;
  }

  async readLocalDataFile(input: {
    userId: string;
    projectKey: string;
    pluginId: string;
    scope?: PluginLocalDataScope;
    path: string;
    encoding?: PluginLocalDataEncoding;
  }): Promise<PluginLocalDataFile> {
    const root = await this.resolvePluginLocalDataRoot({
      userId: input.userId,
      projectKey: input.projectKey,
      pluginId: input.pluginId,
      scope: input.scope,
    });
    const relativePath = normalizePluginLocalDataRelativePath(input.path);
    const absolutePath = joinPluginPath(root, relativePath);
    const meta = await stat(absolutePath);
    if (!meta.isFile()) {
      throw new Error("Plugin local data path is not a file");
    }
    const contentBuffer = await readFile(absolutePath);
    if (contentBuffer.length > MAX_PLUGIN_LOCAL_DATA_FILE_BYTES) {
      throw new Error("Plugin local data file exceeds size limit");
    }
    const encoding = normalizePluginLocalDataEncoding(input.encoding);
    return {
      path: relativePath,
      content: encoding === "base64" ? contentBuffer.toString("base64") : contentBuffer.toString("utf8"),
      encoding,
      size: contentBuffer.length,
      updatedAt: meta.mtime.toISOString(),
    };
  }

  async writeLocalDataFile(input: {
    userId: string;
    projectKey: string;
    pluginId: string;
    scope?: PluginLocalDataScope;
    path: string;
    content: string;
    encoding?: PluginLocalDataEncoding;
    overwrite?: boolean;
  }): Promise<{
    path: string;
    size: number;
    updatedAt: string;
  }> {
    const root = await this.resolvePluginLocalDataRoot({
      userId: input.userId,
      projectKey: input.projectKey,
      pluginId: input.pluginId,
      scope: input.scope,
    });
    const relativePath = normalizePluginLocalDataRelativePath(input.path);
    const absolutePath = joinPluginPath(root, relativePath);
    const encoding = normalizePluginLocalDataEncoding(input.encoding);

    const rawContent = typeof input.content === "string" ? input.content : "";
    let contentBuffer: Buffer;
    if (encoding === "base64") {
      try {
        contentBuffer = Buffer.from(rawContent, "base64");
      } catch {
        throw new Error("Invalid base64 content");
      }
    } else {
      contentBuffer = Buffer.from(rawContent, "utf8");
    }

    if (contentBuffer.length > MAX_PLUGIN_LOCAL_DATA_FILE_BYTES) {
      throw new Error("Plugin local data file exceeds size limit");
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    if (input.overwrite === false) {
      try {
        await access(absolutePath);
        throw new Error("Plugin local data file already exists");
      } catch (err: unknown) {
        const code = typeof err === "object" && err && "code" in err
          ? String((err as { code?: unknown }).code || "")
          : "";
        if (code && code !== "ENOENT") {
          throw err;
        }
      }
    }

    await writeFile(absolutePath, contentBuffer);
    const fileMeta = await stat(absolutePath);
    return {
      path: relativePath,
      size: fileMeta.size,
      updatedAt: fileMeta.mtime.toISOString(),
    };
  }

  async deleteLocalDataFile(input: {
    userId: string;
    projectKey: string;
    pluginId: string;
    scope?: PluginLocalDataScope;
    path: string;
  }): Promise<{ deleted: boolean }> {
    const root = await this.resolvePluginLocalDataRoot({
      userId: input.userId,
      projectKey: input.projectKey,
      pluginId: input.pluginId,
      scope: input.scope,
    });
    const relativePath = normalizePluginLocalDataRelativePath(input.path);
    const absolutePath = joinPluginPath(root, relativePath);
    try {
      const fileMeta = await stat(absolutePath);
      if (!fileMeta.isFile()) {
        return { deleted: false };
      }
      await unlink(absolutePath);
      return { deleted: true };
    } catch (err: unknown) {
      const code = typeof err === "object" && err && "code" in err
        ? String((err as { code?: unknown }).code || "")
        : "";
      if (code === "ENOENT") {
        return { deleted: false };
      }
      throw err;
    }
  }

  private async getInstalledManifest(userId: string, pluginId: string): Promise<PluginManifestV2> {
    const installation = await pluginInstallStoreV2.get(userId, pluginId);
    if (!installation || installation.status !== "installed") {
      throw new Error(`Plugin is not installed: ${pluginId}`);
    }
    const manifest = await this.loadManifestFromDisk(pluginId, installation.version, userId);
    if (!manifest) {
      throw new Error(`Manifest not found: ${pluginId}@${installation.version}`);
    }
    return manifest;
  }

  private normalizePluginSettings(
    manifest: PluginManifestV2,
    raw: unknown,
    options?: { strictRequired?: boolean },
  ): Record<string, unknown> {
    const strictRequired = options?.strictRequired === true;
    const defaults = collectSettingsDefaults(manifest);
    const fields = manifest.settings?.fields || [];
    if (fields.length === 0) {
      return isObjectRecord(raw) ? { ...raw } : {};
    }

    const source = isObjectRecord(raw) ? raw : {};
    const next: Record<string, unknown> = { ...defaults };
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(source, field.key)) {
        continue;
      }
      const normalized = normalizeSettingFieldValue(manifest, field, source[field.key]);
      next[field.key] = normalized;
    }

    for (const field of fields) {
      const value = next[field.key];
      if (field.required && strictRequired && (value === undefined || value === null || value === "")) {
        throw new Error(`Plugin ${manifest.id} settings field ${field.key} is required`);
      }
    }
    return next;
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
      traceId: input.traceId,
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
      traceId: input.traceId,
      timeoutMs: normalizeExecutionTimeoutMs(manifest),
    });
  }

  async traceFromWeb(input: {
    userId: string;
    projectKey: string;
    pluginId: string;
    method: string;
    args?: Record<string, unknown>;
  }): Promise<unknown> {
    const methodName = String(input.method || "").trim();
    if (!methodName) {
      throw new Error("trace method is required");
    }
    if (methodName === "isEnabled") {
      return isLangfuseEnabled();
    }
    if (!isLangfuseEnabled()) {
      if (methodName === "startSpan" || methodName === "startGeneration") {
        return null;
      }
      return { ok: false };
    }

    const installation = await pluginInstallStoreV2.get(input.userId, input.pluginId);
    if (!installation || installation.status !== "installed" || !installation.enabled) {
      throw new Error(`Plugin is not installed or disabled: ${input.pluginId}`);
    }

    const manifest = await this.getManifestOrThrow(input.pluginId, installation.version, input.userId);
    const args = input.args && typeof input.args === "object"
      ? (input.args as Record<string, unknown>)
      : {};

    const traceName = typeof args.traceName === "string" && args.traceName.trim()
      ? args.traceName.trim()
      : "plugin.web";
    const extraTags = Array.isArray(args.traceTags)
      ? args.traceTags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
      : [];
    const traceTags = ["plugin", input.pluginId, "web", ...extraTags];

    const baseContext: WorkerExecutionContext = {
      pluginId: input.pluginId,
      userId: input.userId,
      projectKey: input.projectKey,
      traceId: undefined,
      permissions: {
        allowedHttpHosts: [],
        maxExecutionMs: 0,
      },
      capabilities: manifest.capabilities,
    };

    const traceMetadata = this.buildPluginTraceMetadata(baseContext, {
      source: "web",
      pluginVersion: manifest.version,
      ...(args.traceMetadata && typeof args.traceMetadata === "object" && !Array.isArray(args.traceMetadata)
        ? args.traceMetadata
        : {}),
    });

    switch (methodName) {
      case "startSpan": {
        const name = String(args.name || "").trim();
        if (!name) {
          throw new Error("trace.startSpan name is required");
        }
        const traceId = typeof args.traceId === "string" ? args.traceId : undefined;
        const traceState = this.ensureWebTraceContext({
          traceId,
          traceName,
          traceTags,
          traceMetadata,
          userId: input.userId,
          projectKey: input.projectKey,
          pluginId: input.pluginId,
        });
        if (!traceState?.traceContext) {
          return null;
        }
        const spanInput = this.buildPluginTraceInput(
          { ...baseContext, traceId: traceState.traceId },
          args.input,
        );
        const span = traceManager.startSpan(traceState.traceContext, name, spanInput);
        this.pluginTraceSpans.set(span.spanId, span);
        if (traceState.ownsTrace) {
          this.retainOwnedTrace(traceState.traceId);
        }
        return { spanId: span.spanId, traceId: traceState.traceId };
      }

      case "endSpan": {
        const spanId = String(args.spanId || "").trim();
        if (!spanId) {
          throw new Error("trace.endSpan spanId is required");
        }
        const span = this.pluginTraceSpans.get(spanId);
        if (!span) {
          return { ok: false };
        }
        traceManager.endSpan(span, args.output, this.normalizeTraceLevel(args.level));
        this.pluginTraceSpans.delete(spanId);
        const traceEnded = this.releaseOwnedTrace(span.traceContext.traceId);
        return { ok: true, traceEnded };
      }

      case "logGeneration": {
        const params = args.params && typeof args.params === "object"
          ? args.params as Record<string, unknown>
          : {};
        const name = String(params.name || "").trim();
        const model = String(params.model || "").trim();
        if (!name || !model) {
          throw new Error("trace.logGeneration requires name and model");
        }
        const traceId = typeof params.traceId === "string" ? params.traceId : undefined;
        const traceState = this.ensureWebTraceContext({
          traceId,
          traceName,
          traceTags,
          traceMetadata,
          userId: input.userId,
          projectKey: input.projectKey,
          pluginId: input.pluginId,
        });
        if (!traceState?.traceContext) {
          return { ok: false };
        }
        traceManager.logGeneration(traceState.traceContext, {
          name,
          model,
          provider: typeof params.provider === "string" ? params.provider : undefined,
          input: params.input,
          output: typeof params.output === "string" ? params.output : undefined,
          usage: this.normalizeTraceUsage(params.usage),
          startTime: this.normalizeTraceDate(params.startTime),
          endTime: this.normalizeTraceDate(params.endTime),
          level: this.normalizeTraceLevel(params.level),
          statusMessage: typeof params.statusMessage === "string" ? params.statusMessage : undefined,
          metadata: this.buildPluginTraceMetadata(baseContext, params.metadata),
        });
        const traceEnded = traceState.created && !this.pluginTraceOwners.has(traceState.traceId);
        if (traceEnded) {
          traceManager.endTrace(traceState.traceId, { status: "ok" });
        }
        return { ok: true, traceId: traceState.traceId, traceEnded };
      }

      case "startGeneration": {
        const params = args.params && typeof args.params === "object"
          ? args.params as Record<string, unknown>
          : {};
        const name = String(params.name || "").trim();
        const model = String(params.model || "").trim();
        if (!name || !model) {
          throw new Error("trace.startGeneration requires name and model");
        }
        const traceId = typeof params.traceId === "string" ? params.traceId : undefined;
        const traceState = this.ensureWebTraceContext({
          traceId,
          traceName,
          traceTags,
          traceMetadata,
          userId: input.userId,
          projectKey: input.projectKey,
          pluginId: input.pluginId,
        });
        if (!traceState?.traceContext) {
          return null;
        }
        const generation = traceManager.startGeneration(traceState.traceContext, {
          name,
          model,
          provider: typeof params.provider === "string" ? params.provider : undefined,
          input: params.input,
          startTime: this.normalizeTraceDate(params.startTime),
          level: this.normalizeTraceLevel(params.level),
          statusMessage: typeof params.statusMessage === "string" ? params.statusMessage : undefined,
          metadata: this.buildPluginTraceMetadata(baseContext, params.metadata),
        });
        if (!generation) {
          return null;
        }
        const generationId = this.nextTraceHandle(`gen-${input.pluginId}`);
        this.pluginTraceGenerations.set(generationId, {
          generation,
          traceId: traceState.traceId,
          ownsTrace: traceState.ownsTrace,
        });
        if (traceState.ownsTrace) {
          this.retainOwnedTrace(traceState.traceId);
        }
        return { generationId, traceId: traceState.traceId };
      }

      case "endGeneration": {
        const generationId = String(args.generationId || "").trim();
        if (!generationId) {
          throw new Error("trace.endGeneration generationId is required");
        }
        const entry = this.pluginTraceGenerations.get(generationId);
        if (!entry) {
          return { ok: false };
        }
        const output = typeof args.output === "string" ? args.output : "";
        traceManager.endGeneration(
          entry.generation,
          output,
          this.normalizeTraceUsage(args.usage),
          this.normalizeTraceLevel(args.level),
          typeof args.statusMessage === "string" ? args.statusMessage : undefined,
        );
        this.pluginTraceGenerations.delete(generationId);
        const traceEnded = entry.ownsTrace ? this.releaseOwnedTrace(entry.traceId) : false;
        return { ok: true, traceEnded };
      }

      default:
        throw new Error(`Unknown trace method: ${methodName}`);
    }
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
      traceId?: string;
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
      traceId: input.traceId,
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
    traceId?: string;
    traceName?: string;
    traceTags?: string[];
    traceMetadata?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const versionDir = resolvePluginVersionDir(input.manifest.id, input.manifest.version, input.userId);
    const backendPath = joinPluginPath(versionDir, input.backendEntry);
    await access(backendPath);

    const traceName = input.traceName || "plugin.execute";
    const traceTags = ["plugin", input.manifest.id, ...(input.traceTags || [])];
    const traceMetadata = {
      pluginId: input.manifest.id,
      pluginVersion: input.manifest.version,
      handler: input.handler,
      ...this.buildPluginTraceMetadata({
        pluginId: input.manifest.id,
        userId: input.context.userId,
        projectKey: input.context.projectKey,
        permissions: { allowedHttpHosts: [], maxExecutionMs: 0 },
      }, input.traceMetadata),
    };

    let ownsTrace = false;
    const traceContext = (() => {
      const explicit = typeof input.traceId === "string" ? input.traceId.trim() : "";
      if (explicit) {
        const existing = traceManager.getTrace(explicit);
        if (existing) return existing;
        ownsTrace = true;
        return traceManager.startTrace(explicit, {
          name: traceName,
          userId: input.context.userId,
          projectKey: input.context.projectKey,
          tags: traceTags,
          metadata: traceMetadata,
        });
      }

      const generated = `plugin-${input.manifest.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      ownsTrace = true;
      return traceManager.startTrace(generated, {
        name: traceName,
        userId: input.context.userId,
        projectKey: input.context.projectKey,
        tags: traceTags,
        metadata: traceMetadata,
      });
    })();

    const execSpan = traceContext?.trace
      ? traceManager.startSpan(traceContext, traceName, {
          handler: input.handler,
          pluginId: input.manifest.id,
          projectKey: input.context.projectKey,
          userId: input.context.userId,
        })
      : null;

    const executionContext: WorkerExecutionContext = {
      pluginId: input.manifest.id,
      userId: input.context.userId,
      projectKey: input.context.projectKey,
      traceId: traceContext?.traceId || input.traceId,
      permissions: {
        allowedHttpHosts: input.manifest.permissions?.allowedHttpHosts || [],
        maxExecutionMs: normalizeExecutionTimeoutMs(input.manifest),
      },
      capabilities: input.manifest.capabilities,
    };

    try {
      const result = await this.workerPool.execute(
        input.manifest.id,
        input.manifest.version,
        backendPath,
        input.handler,
        input.input,
        executionContext,
        Math.max(200, Math.round(input.timeoutMs || normalizeExecutionTimeoutMs(input.manifest))),
      );

      if (execSpan) {
        traceManager.endSpan(execSpan, { status: "ok" });
      }

      if (ownsTrace && traceContext) {
        traceManager.endTrace(traceContext.traceId, { status: "ok" });
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (execSpan) {
        traceManager.endSpan(execSpan, { status: "error", error: message }, "ERROR");
      }
      if (ownsTrace && traceContext) {
        traceManager.endTrace(traceContext.traceId, { error: message });
      }
      throw err;
    }
  }

  private nextTraceHandle(prefix: string): string {
    this.traceHandleSeq += 1;
    return `${prefix}-${Date.now()}-${this.traceHandleSeq}`;
  }

  private retainOwnedTrace(traceId: string): void {
    if (!traceId) return;
    const current = this.pluginTraceOwners.get(traceId);
    if (current) {
      current.count += 1;
      return;
    }
    this.pluginTraceOwners.set(traceId, { count: 1 });
  }

  private releaseOwnedTrace(traceId: string): boolean {
    if (!traceId) return false;
    const current = this.pluginTraceOwners.get(traceId);
    if (!current) {
      return false;
    }
    current.count -= 1;
    if (current.count > 0) {
      this.pluginTraceOwners.set(traceId, current);
      return false;
    }
    this.pluginTraceOwners.delete(traceId);
    traceManager.endTrace(traceId, { status: "ok" });
    return true;
  }

  private getTraceContext(context: WorkerExecutionContext): TraceContext | null {
    const traceId = typeof context.traceId === "string" ? context.traceId.trim() : "";
    if (!traceId) return null;
    return traceManager.getTrace(traceId);
  }

  private ensureWebTraceContext(input: {
    traceId?: string;
    traceName: string;
    traceTags: string[];
    traceMetadata: Record<string, unknown>;
    userId: string;
    projectKey: string;
    pluginId: string;
  }): { traceContext: TraceContext; traceId: string; ownsTrace: boolean; created: boolean } | null {
    if (!isLangfuseEnabled()) {
      return null;
    }
    const explicit = typeof input.traceId === "string" ? input.traceId.trim() : "";
    if (explicit) {
      const existing = traceManager.getTrace(explicit);
      if (existing) {
        return {
          traceContext: existing,
          traceId: explicit,
          ownsTrace: this.pluginTraceOwners.has(explicit),
          created: false,
        };
      }
      const traceContext = traceManager.startTrace(explicit, {
        name: input.traceName,
        userId: input.userId,
        projectKey: input.projectKey,
        tags: input.traceTags,
        metadata: input.traceMetadata,
      });
      return {
        traceContext,
        traceId: explicit,
        ownsTrace: true,
        created: true,
      };
    }

    const generated = `plugin-web-${input.pluginId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const traceContext = traceManager.startTrace(generated, {
      name: input.traceName,
      userId: input.userId,
      projectKey: input.projectKey,
      tags: input.traceTags,
      metadata: input.traceMetadata,
    });
    return {
      traceContext,
      traceId: generated,
      ownsTrace: true,
      created: true,
    };
  }

  private buildPluginTraceInput(context: WorkerExecutionContext, input: unknown): unknown {
    const pluginMeta = {
      pluginId: context.pluginId,
      userId: context.userId,
      projectKey: context.projectKey,
    };

    if (!input) {
      return { _plugin: pluginMeta };
    }
    if (typeof input === "object" && !Array.isArray(input)) {
      return { ...(input as Record<string, unknown>), _plugin: pluginMeta };
    }
    return { input, _plugin: pluginMeta };
  }

  private buildPluginTraceMetadata(context: WorkerExecutionContext, metadata: unknown): Record<string, unknown> {
    const base = (metadata && typeof metadata === "object" && !Array.isArray(metadata))
      ? (metadata as Record<string, unknown>)
      : {};
    return {
      ...base,
      pluginId: context.pluginId,
      userId: context.userId,
      projectKey: context.projectKey,
    };
  }

  private normalizeTraceLevel(value: unknown): "DEBUG" | "DEFAULT" | "WARNING" | "ERROR" | undefined {
    if (value === "DEBUG" || value === "DEFAULT" || value === "WARNING" || value === "ERROR") {
      return value;
    }
    return undefined;
  }

  private normalizeTraceUsage(value: unknown): {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const row = value as Record<string, unknown>;
    const promptTokens = typeof row.promptTokens === "number" ? row.promptTokens : undefined;
    const completionTokens = typeof row.completionTokens === "number" ? row.completionTokens : undefined;
    const totalTokens = typeof row.totalTokens === "number" ? row.totalTokens : undefined;
    if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
      return undefined;
    }
    return { promptTokens, completionTokens, totalTokens };
  }

  private normalizeTraceDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
      if (!Number.isNaN(value.getTime())) {
        return value;
      }
      return undefined;
    }
    if (typeof value !== "string") {
      return undefined;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed;
  }

  private normalizePptFilename(value: unknown, fallback: string): string {
    const raw = typeof value === "string" ? value.trim() : "";
    const base = raw || fallback;
    const sanitized = base.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    return sanitized || fallback;
  }

  private async waitForPptTask(
    taskId: string,
    waitMs: number,
    pollIntervalMs: number,
  ): Promise<{ status: "pending" | "processing" | "completed" | "failed"; error?: string; waitedMs: number }> {
    const { pptService } = await import("../services/ppt/index.js");
    const startedAt = Date.now();
    let status = await pptService.getTaskStatus(taskId);
    const shouldContinue = () =>
      (status.status === "pending" || status.status === "processing")
      && Date.now() - startedAt < waitMs;

    while (shouldContinue()) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      status = await pptService.getTaskStatus(taskId);
    }

    return {
      status: status.status,
      error: status.error,
      waitedMs: Date.now() - startedAt,
    };
  }

  private async handleHostCall(
    context: WorkerExecutionContext,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const methodName = String(method || "").trim();

    switch (methodName) {
      case "trace.isEnabled": {
        const traceContext = this.getTraceContext(context);
        return Boolean(traceContext?.trace);
      }

      case "trace.startSpan": {
        const traceContext = this.getTraceContext(context);
        if (!traceContext) {
          return null;
        }
        const name = String(args.name || "").trim();
        if (!name) {
          throw new Error("trace.startSpan name is required");
        }
        const spanInput = this.buildPluginTraceInput(context, args.input);
        const span = traceManager.startSpan(traceContext, name, spanInput);
        this.pluginTraceSpans.set(span.spanId, span);
        return { spanId: span.spanId };
      }

      case "trace.endSpan": {
        const spanId = String(args.spanId || "").trim();
        if (!spanId) {
          throw new Error("trace.endSpan spanId is required");
        }
        const span = this.pluginTraceSpans.get(spanId);
        if (!span) {
          return { ok: false };
        }
        traceManager.endSpan(span, args.output, this.normalizeTraceLevel(args.level));
        this.pluginTraceSpans.delete(spanId);
        return { ok: true };
      }

      case "trace.logGeneration": {
        const traceContext = this.getTraceContext(context);
        if (!traceContext) {
          return { ok: false };
        }
        const params = args.params && typeof args.params === "object"
          ? args.params as Record<string, unknown>
          : {};
        const name = String(params.name || "").trim();
        const model = String(params.model || "").trim();
        if (!name || !model) {
          throw new Error("trace.logGeneration requires name and model");
        }

        traceManager.logGeneration(traceContext, {
          name,
          model,
          provider: typeof params.provider === "string" ? params.provider : undefined,
          input: params.input,
          output: typeof params.output === "string" ? params.output : undefined,
          usage: this.normalizeTraceUsage(params.usage),
          startTime: this.normalizeTraceDate(params.startTime),
          endTime: this.normalizeTraceDate(params.endTime),
          level: this.normalizeTraceLevel(params.level),
          statusMessage: typeof params.statusMessage === "string" ? params.statusMessage : undefined,
          metadata: this.buildPluginTraceMetadata(context, params.metadata),
        });
        return { ok: true };
      }

      case "trace.startGeneration": {
        const traceContext = this.getTraceContext(context);
        if (!traceContext) {
          return null;
        }
        const params = args.params && typeof args.params === "object"
          ? args.params as Record<string, unknown>
          : {};
        const name = String(params.name || "").trim();
        const model = String(params.model || "").trim();
        if (!name || !model) {
          throw new Error("trace.startGeneration requires name and model");
        }

        const generation = traceManager.startGeneration(traceContext, {
          name,
          model,
          provider: typeof params.provider === "string" ? params.provider : undefined,
          input: params.input,
          startTime: this.normalizeTraceDate(params.startTime),
          level: this.normalizeTraceLevel(params.level),
          statusMessage: typeof params.statusMessage === "string" ? params.statusMessage : undefined,
          metadata: this.buildPluginTraceMetadata(context, params.metadata),
        });

        if (!generation) {
          return null;
        }

        const generationId = this.nextTraceHandle(`gen-${context.pluginId}`);
        this.pluginTraceGenerations.set(generationId, {
          generation,
          traceId: traceContext.traceId,
          ownsTrace: false,
        });
        return { generationId };
      }

      case "trace.endGeneration": {
        const generationId = String(args.generationId || "").trim();
        if (!generationId) {
          throw new Error("trace.endGeneration generationId is required");
        }
        const entry = this.pluginTraceGenerations.get(generationId);
        if (!entry) {
          return { ok: false };
        }
        const output = typeof args.output === "string" ? args.output : "";
        traceManager.endGeneration(
          entry.generation,
          output,
          this.normalizeTraceUsage(args.usage),
          this.normalizeTraceLevel(args.level),
          typeof args.statusMessage === "string" ? args.statusMessage : undefined,
        );
        this.pluginTraceGenerations.delete(generationId);
        const traceEnded = entry.ownsTrace ? this.releaseOwnedTrace(entry.traceId) : false;
        return { ok: true, traceEnded };
      }

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

      case "getPluginSettings": {
        const targetPluginId = String(args.pluginId || context.pluginId).trim();
        if (!targetPluginId || targetPluginId !== context.pluginId) {
          throw new Error("pluginId is invalid for getPluginSettings");
        }
        return await this.getPluginSettings(context.userId, targetPluginId);
      }

      case "listPluginDataFiles": {
        const targetPluginId = String(args.pluginId || context.pluginId).trim();
        if (!targetPluginId || targetPluginId !== context.pluginId) {
          throw new Error("pluginId is invalid for listPluginDataFiles");
        }
        return this.listLocalDataFiles({
          userId: context.userId,
          projectKey: String(args.projectKey || context.projectKey).trim(),
          pluginId: targetPluginId,
          scope: normalizePluginLocalDataScope(args.scope),
          dir: typeof args.dir === "string" ? args.dir : "",
          limit: Number(args.limit || 200),
        });
      }

      case "readPluginDataFile": {
        const targetPluginId = String(args.pluginId || context.pluginId).trim();
        if (!targetPluginId || targetPluginId !== context.pluginId) {
          throw new Error("pluginId is invalid for readPluginDataFile");
        }
        const dataPath = String(args.path || "").trim();
        if (!dataPath) {
          throw new Error("path is required");
        }
        return this.readLocalDataFile({
          userId: context.userId,
          projectKey: String(args.projectKey || context.projectKey).trim(),
          pluginId: targetPluginId,
          scope: normalizePluginLocalDataScope(args.scope),
          path: dataPath,
          encoding: normalizePluginLocalDataEncoding(args.encoding),
        });
      }

      case "writePluginDataFile": {
        const targetPluginId = String(args.pluginId || context.pluginId).trim();
        if (!targetPluginId || targetPluginId !== context.pluginId) {
          throw new Error("pluginId is invalid for writePluginDataFile");
        }
        const dataPath = String(args.path || "").trim();
        if (!dataPath) {
          throw new Error("path is required");
        }
        if (typeof args.content !== "string") {
          throw new Error("content must be a string");
        }
        return this.writeLocalDataFile({
          userId: context.userId,
          projectKey: String(args.projectKey || context.projectKey).trim(),
          pluginId: targetPluginId,
          scope: normalizePluginLocalDataScope(args.scope),
          path: dataPath,
          content: args.content,
          encoding: normalizePluginLocalDataEncoding(args.encoding),
          overwrite: args.overwrite !== false,
        });
      }

      case "deletePluginDataFile": {
        const targetPluginId = String(args.pluginId || context.pluginId).trim();
        if (!targetPluginId || targetPluginId !== context.pluginId) {
          throw new Error("pluginId is invalid for deletePluginDataFile");
        }
        const dataPath = String(args.path || "").trim();
        if (!dataPath) {
          throw new Error("path is required");
        }
        return this.deleteLocalDataFile({
          userId: context.userId,
          projectKey: String(args.projectKey || context.projectKey).trim(),
          pluginId: targetPluginId,
          scope: normalizePluginLocalDataScope(args.scope),
          path: dataPath,
        });
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

      case "exportDocumentPpt": {
        this.assertCapability(context, "docs.read", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const docId = String(args.docId || "").trim();
        if (!docId) {
          throw new Error("docId is required");
        }

        const requestRow = args.request && typeof args.request === "object"
          ? args.request as Record<string, unknown>
          : {};
        const styleRow = requestRow.style && typeof requestRow.style === "object"
          ? requestRow.style as Record<string, unknown>
          : {};
        const optionsRow = requestRow.options && typeof requestRow.options === "object"
          ? requestRow.options as Record<string, unknown>
          : {};

        const style = {
          description: typeof styleRow.description === "string" ? styleRow.description : undefined,
          templateId: typeof styleRow.templateId === "string" ? styleRow.templateId : undefined,
          templateImages: Array.isArray(styleRow.templateImages)
            ? styleRow.templateImages.map((item) => String(item || "").trim()).filter(Boolean)
            : undefined,
        };
        const aspectRatioRaw = String(optionsRow.aspectRatio || "").trim();
        let aspectRatio: "16:9" | "4:3" | undefined;
        if (aspectRatioRaw === "16:9" || aspectRatioRaw === "4:3") {
          aspectRatio = aspectRatioRaw;
        }
        const options = {
          aspectRatio,
          language: typeof optionsRow.language === "string" ? optionsRow.language : undefined,
        };

        const doc = await documentStore.get(context.userId, projectKey, docId);
        const body = doc.body?.content as Record<string, unknown> | undefined;
        if (!body || body.type !== "doc") {
          throw new Error("Document has no valid Tiptap content");
        }

        const { pptService } = await import("../services/ppt/index.js");
        const available = await pptService.isAvailable();
        if (!available) {
          throw new Error("PPT generation service is not available");
        }

        const result = await pptService.generateFromDocument(body as any, style, options);
        return {
          taskId: result.taskId,
          status: result.status,
        };
      }

      case "generatePptFromHtml": {
        this.assertCapability(context, "docs.write", methodName);
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const html = typeof args.html === "string" ? args.html : "";
        if (!html.trim()) {
          throw new Error("html is required");
        }

        const exportBackend = String(process.env.PPT_EXPORT_BACKEND || "local").trim().toLowerCase();
        const preferBanana = exportBackend === "banana";
        const preferAuto = exportBackend === "auto";

        const style = args.style && typeof args.style === "object"
          ? args.style as {
            description?: string;
            templateId?: string;
            templateImages?: string[];
          }
          : undefined;

        const options = args.options && typeof args.options === "object"
          ? args.options as {
            aspectRatio?: "16:9" | "4:3";
            language?: string;
          }
          : undefined;

        const filenameBase = this.normalizePptFilename(args.fileName, `presentation-${Date.now()}`);
        const htmlFilename = filenameBase.toLowerCase().endsWith(".html")
          ? filenameBase
          : `${filenameBase}.html`;

        if (!preferBanana) {
          if (preferAuto) {
            const { pptService } = await import("../services/ppt/index.js");
            const available = await pptService.isAvailable();
            if (available) {
              const result = await pptService.generateFromFile(
                Buffer.from(html, "utf-8"),
                htmlFilename,
                style,
              );

              const maxWaitMsRaw = typeof args.waitMs === "number" ? args.waitMs : context.permissions.maxExecutionMs;
              const maxWaitMs = Math.max(0, Math.min(Math.floor(maxWaitMsRaw || 0), 60000));
              const pollIntervalMsRaw = typeof args.pollIntervalMs === "number" ? args.pollIntervalMs : 1000;
              const pollIntervalMs = Math.max(200, Math.min(Math.floor(pollIntervalMsRaw || 1000), 5000));

              const taskStatus = await this.waitForPptTask(result.taskId, maxWaitMs, pollIntervalMs);
              if (taskStatus.status !== "completed") {
                return {
                  taskId: result.taskId,
                  status: taskStatus.status,
                  error: taskStatus.error,
                  waitedMs: taskStatus.waitedMs,
                };
              }

              const buffer = await pptService.downloadPPTX(result.taskId);
              const pptFilename = filenameBase.toLowerCase().endsWith(".pptx")
                ? filenameBase
                : `${filenameBase}.pptx`;
              const assetMeta = await assetStore.save(
                context.userId,
                projectKey,
                pptFilename,
                PPT_MIME,
                buffer,
              );

              return {
                taskId: result.taskId,
                status: taskStatus.status,
                asset: {
                  id: assetMeta.id,
                  filename: assetMeta.filename,
                  mime: assetMeta.mime,
                  size: assetMeta.size,
                },
                waitedMs: taskStatus.waitedMs,
              };
            }
          }

          const { exportHtmlToPptxBuffer } = await import("../services/ppt/local-html-export.js");
          const startedAt = Date.now();
          const buffer = await exportHtmlToPptxBuffer(html, { aspectRatio: options?.aspectRatio });
          const pptFilename = filenameBase.toLowerCase().endsWith(".pptx")
            ? filenameBase
            : `${filenameBase}.pptx`;
          const assetMeta = await assetStore.save(
            context.userId,
            projectKey,
            pptFilename,
            PPT_MIME,
            buffer,
          );

          return {
            taskId: `local-${Date.now()}`,
            status: "completed",
            asset: {
              id: assetMeta.id,
              filename: assetMeta.filename,
              mime: assetMeta.mime,
              size: assetMeta.size,
            },
            waitedMs: Date.now() - startedAt,
          };
        }

        const { pptService } = await import("../services/ppt/index.js");
        const available = await pptService.isAvailable();
        if (!available) {
          throw new Error("PPT generation service is not available");
        }

        const result = await pptService.generateFromFile(
          Buffer.from(html, "utf-8"),
          htmlFilename,
          style,
        );

        const maxWaitMsRaw = typeof args.waitMs === "number" ? args.waitMs : context.permissions.maxExecutionMs;
        const maxWaitMs = Math.max(0, Math.min(Math.floor(maxWaitMsRaw || 0), 60000));
        const pollIntervalMsRaw = typeof args.pollIntervalMs === "number" ? args.pollIntervalMs : 1000;
        const pollIntervalMs = Math.max(200, Math.min(Math.floor(pollIntervalMsRaw || 1000), 5000));

        const taskStatus = await this.waitForPptTask(result.taskId, maxWaitMs, pollIntervalMs);
        if (taskStatus.status !== "completed") {
          return {
            taskId: result.taskId,
            status: taskStatus.status,
            error: taskStatus.error,
            waitedMs: taskStatus.waitedMs,
          };
        }

        const buffer = await pptService.downloadPPTX(result.taskId);
        const pptFilename = filenameBase.toLowerCase().endsWith(".pptx")
          ? filenameBase
          : `${filenameBase}.pptx`;
        const assetMeta = await assetStore.save(
          context.userId,
          projectKey,
          pptFilename,
          PPT_MIME,
          buffer,
        );

        return {
          taskId: result.taskId,
          status: taskStatus.status,
          asset: {
            id: assetMeta.id,
            filename: assetMeta.filename,
            mime: assetMeta.mime,
            size: assetMeta.size,
          },
          waitedMs: taskStatus.waitedMs,
        };
      }

      case "getPptTaskStatus": {
        this.assertCapability(context, "docs.read", methodName);
        const taskId = String(args.taskId || "").trim();
        if (!taskId) {
          throw new Error("taskId is required");
        }

        const { pptService } = await import("../services/ppt/index.js");
        const status = await pptService.getTaskStatus(taskId);
        return {
          taskId: status.taskId,
          status: status.status,
          progress: status.progress,
          currentSlide: status.currentSlide,
          totalSlides: status.totalSlides,
          error: status.error,
          createdAt: status.createdAt,
          updatedAt: status.updatedAt,
        };
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

  private getManifestCacheKey(pluginId: string, version: string, userId?: string): string {
    const userSegment = userId ? `user:${userId}` : "global";
    return `${userSegment}:${pluginId}@${version}`;
  }

  private async loadManifestFromDisk(pluginId: string, version: string, userId?: string): Promise<PluginManifestV2 | null> {
    const key = this.getManifestCacheKey(pluginId, version, userId);
    const cached = this.manifestCache.get(key);
    if (cached) {
      try {
        const meta = await stat(cached.manifestPath);
        if (meta.isFile() && meta.mtimeMs === cached.mtimeMs) {
          return cached.manifest;
        }
      } catch {
        // manifest file disappeared or became unreadable; fall through to reload.
      }
      this.manifestCache.delete(key);
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
        const meta = await stat(manifestPath);
        if (!meta.isFile()) {
          continue;
        }
        const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
        const manifest = parsePluginManifestV2(raw);
        validatePluginManifestV2(manifest, {
          appBackend: pluginConfig.appBackendVersion,
          web: pluginConfig.webVersion,
        });
        this.manifestCache.set(key, {
          manifest,
          manifestPath,
          mtimeMs: meta.mtimeMs,
        });
        return manifest;
      } catch {
        // continue
      }
    }

    return null;
  }

  private async ensureManifestFromDisk(pluginId: string, version: string): Promise<void> {
    const key = this.getManifestCacheKey(pluginId, version);
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

  private async resolvePluginLocalDataRoot(input: {
    userId: string;
    projectKey: string;
    pluginId: string;
    scope?: PluginLocalDataScope;
  }): Promise<string> {
    const installation = await pluginInstallStoreV2.get(input.userId, input.pluginId);
    if (!installation || installation.status !== "installed" || !installation.enabled) {
      throw new Error(`Plugin is not installed or disabled: ${input.pluginId}`);
    }

    const scope = normalizePluginLocalDataScope(input.scope);
    const root = scope === "global"
      ? getUserPluginDataGlobalRoot(input.userId, input.pluginId)
      : getUserPluginDataProjectRoot(input.userId, input.projectKey, input.pluginId);
    await mkdir(root, { recursive: true });
    return root;
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
