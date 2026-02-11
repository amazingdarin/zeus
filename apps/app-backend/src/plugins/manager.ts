import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { lookup as lookupMimeType } from "mime-types";
import type {
  PluginCommandDescriptor,
  PluginInstallationRecord,
  PluginManifest,
  PluginRuntimeItem,
  PluginStorePluginSummary,
  PluginStoreVersion,
} from "@zeus/plugin-sdk-shared";

import { pluginConfig, resolvePluginVersionDir } from "./config.js";
import {
  assertManifestIntegrity,
  parsePluginManifest,
  validatePluginManifest,
  verifyManifestSignature,
} from "./manifest.js";
import { pluginStoreClient } from "./store-client.js";
import { pluginInstallStore } from "./install-store.js";
import { registerPluginBlockTypes } from "./block-registry.js";
import { PluginWorkerPool, type WorkerExecutionContext } from "./worker/worker-pool.js";
import { registerBlockIdNodeTypes } from "../utils/block-id.js";
import { documentStore, DocumentNotFoundError } from "../storage/document-store.js";
import { assetStore } from "../storage/asset-store.js";
import { knowledgeSearch } from "../knowledge/search.js";
import { documentSkills } from "../llm/skills/document-skills.js";
import { skillRegistry } from "../llm/skills/registry.js";
import { query } from "../db/postgres.js";

type InstalledPlugin = {
  installation: PluginInstallationRecord;
  manifest: PluginManifest;
};

type PluginOperationDescriptor = {
  id: string;
  title: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  requiresDocScope: boolean;
};

const execFileAsync = promisify(execFile);

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

function safeVersionSort(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true });
}

export class PluginManager {
  private readonly manifestCache = new Map<string, PluginManifest>();
  private readonly operationCache = new Map<string, PluginOperationDescriptor[]>();
  private readonly workerPool = new PluginWorkerPool(this.handleHostCall.bind(this));
  private readonly coreCommands = new Set(documentSkills.map((skill) => skill.command));

  async initialize(): Promise<void> {
    await mkdir(pluginConfig.rootDir, { recursive: true });
    await this.refreshInstalledBlockTypes();
  }

  async listStorePlugins(query: string): Promise<PluginStorePluginSummary[]> {
    const result = await pluginStoreClient.listPlugins(query);
    return result.plugins;
  }

  async listStorePluginVersions(pluginId: string): Promise<PluginStoreVersion[]> {
    return pluginStoreClient.getPluginVersions(pluginId);
  }

  async listUserPlugins(userId: string): Promise<InstalledPlugin[]> {
    const rows = await pluginInstallStore.listByUser(userId);
    const installed: InstalledPlugin[] = [];
    for (const row of rows) {
      if (row.status === "uninstalled") {
        continue;
      }
      const manifest = await this.loadManifestFromDisk(row.pluginId, row.version);
      if (!manifest) continue;
      installed.push({
        installation: row,
        manifest,
      });
    }
    return installed;
  }

  async installPlugin(
    userId: string,
    pluginId: string,
    requestedVersion?: string,
  ): Promise<{ installation: PluginInstallationRecord; manifest: PluginManifest }> {
    const versions = await pluginStoreClient.getPluginVersions(pluginId);
    if (versions.length === 0) {
      throw new Error(`Plugin not found in store: ${pluginId}`);
    }

    const selected = requestedVersion
      ? versions.find((item) => item.version === requestedVersion)
      : versions[0];

    if (!selected) {
      throw new Error(`Version not found: ${pluginId}@${requestedVersion}`);
    }

    await pluginInstallStore.upsert(userId, pluginId, {
      version: selected.version,
      enabled: false,
      status: "installing",
    });

    const startedAt = Date.now();
    let tempExtractDir: string | null = null;
    try {
      const packageBuffer = await pluginStoreClient.downloadPackage(pluginId, selected.version);
      const extracted = await this.extractToTemporaryRoot(pluginId, selected.version, packageBuffer);
      tempExtractDir = extracted.tmpDir;
      const extractedRoot = extracted.packageRoot;

      const manifestPath = path.join(extractedRoot, "manifest.json");
      const rawManifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      const manifest = parsePluginManifest(rawManifest);

      if (manifest.id !== pluginId || manifest.version !== selected.version) {
        throw new Error(`Manifest mismatch: expected ${pluginId}@${selected.version}`);
      }

      validatePluginManifest(manifest, {
        appBackend: pluginConfig.appBackendVersion,
        web: pluginConfig.webVersion,
      });

      const digest = assertManifestIntegrity(manifest, packageBuffer);
      verifyManifestSignature(
        manifest,
        digest,
        pluginConfig.signaturePublicKeyPem,
        pluginConfig.requireSignature,
      );

      await this.assertCommandConflicts(userId, pluginId, manifest.commands || []);

      const versionDir = resolvePluginVersionDir(pluginId, selected.version);
      await rm(versionDir, { recursive: true, force: true });
      await mkdir(path.dirname(versionDir), { recursive: true });
      await cp(extractedRoot, versionDir, { recursive: true, force: true });

      this.manifestCache.set(`${pluginId}@${selected.version}`, manifest);
      this.registerManifestBlockTypes(manifest);

      const installation = await pluginInstallStore.upsert(userId, pluginId, {
        version: selected.version,
        enabled: true,
        status: "installed",
        lastError: null,
      });

      await pluginInstallStore.appendAudit({
        userId,
        pluginId,
        operationId: "install",
        projectScope: "global",
        status: "ok",
        durationMs: Date.now() - startedAt,
      });

      return { installation, manifest };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await pluginInstallStore.upsert(userId, pluginId, {
        version: selected.version,
        enabled: false,
        status: "failed",
        lastError: message,
      });
      await pluginInstallStore.appendAudit({
        userId,
        pluginId,
        operationId: "install",
        projectScope: "global",
        status: "error",
        durationMs: Date.now() - startedAt,
        error: message,
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
  ): Promise<PluginInstallationRecord> {
    const installation = await pluginInstallStore.get(userId, pluginId);
    if (!installation || installation.status !== "installed") {
      throw new Error(`Plugin is not installed: ${pluginId}`);
    }

    const updated = await pluginInstallStore.updateEnabled(userId, pluginId, enabled);
    if (!updated) {
      throw new Error(`Plugin is not installed: ${pluginId}`);
    }
    return updated;
  }

  async uninstallPlugin(userId: string, pluginId: string): Promise<boolean> {
    const removed = await pluginInstallStore.remove(userId, pluginId);
    await pluginInstallStore.appendAudit({
      userId,
      pluginId,
      operationId: "uninstall",
      projectScope: "global",
      status: removed ? "ok" : "not_found",
      durationMs: 0,
    });
    return removed;
  }

  async getPluginSettings(userId: string, pluginId: string): Promise<Record<string, unknown>> {
    const settings = await pluginInstallStore.getSettings(userId, pluginId);
    return settings || {};
  }

  async setPluginSettings(
    userId: string,
    pluginId: string,
    settings: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const installation = await pluginInstallStore.get(userId, pluginId);
    if (!installation || installation.status !== "installed") {
      throw new Error(`Plugin is not installed: ${pluginId}`);
    }
    return pluginInstallStore.setSettings(userId, pluginId, settings);
  }

  async getRuntimeForUser(userId: string): Promise<PluginRuntimeItem[]> {
    const plugins = await this.listUserPlugins(userId);
    const runtimeItems: PluginRuntimeItem[] = [];

    for (const plugin of plugins) {
      if (plugin.installation.status !== "installed" || !plugin.installation.enabled) {
        continue;
      }

      const frontendEntry = plugin.manifest.frontend?.entry
        ? this.buildFrontendEntryUrl(plugin.manifest.id, plugin.manifest.version, plugin.manifest.frontend.entry)
        : undefined;

      runtimeItems.push({
        pluginId: plugin.manifest.id,
        version: plugin.manifest.version,
        displayName: plugin.manifest.displayName,
        frontendEntryUrl: frontendEntry,
        capabilities: plugin.manifest.capabilities || [],
        commands: plugin.manifest.commands || [],
        contributions: plugin.manifest.contributions || {},
      });
    }

    return runtimeItems.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  async resolveAssetPathForUser(
    userId: string,
    pluginId: string,
    version: string,
    relativePath: string,
  ): Promise<{ path: string; mime: string }> {
    const installation = await pluginInstallStore.get(userId, pluginId);
    if (!installation || installation.status !== "installed" || !installation.enabled) {
      throw new Error(`Plugin is not available: ${pluginId}`);
    }
    if (installation.version !== version) {
      throw new Error(`Plugin version mismatch: ${pluginId}`);
    }

    const versionDir = resolvePluginVersionDir(pluginId, version);
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
    const content = await readFile(resolved.path);
    return {
      content,
      mime: resolved.mime,
      absolutePath: resolved.path,
    };
  }

  async executeOperation(input: {
    userId: string;
    projectKey: string;
    pluginId: string;
    operationId: string;
    args?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const installation = await pluginInstallStore.get(input.userId, input.pluginId);
    if (!installation || installation.status !== "installed" || !installation.enabled) {
      throw new Error(`Plugin is not installed or disabled: ${input.pluginId}`);
    }

    const manifest = await this.getManifestOrThrow(input.pluginId, installation.version);
    if (!manifest.capabilities.includes("doc.operation.execute")) {
      throw new Error(`Plugin ${manifest.id} does not have doc.operation.execute capability`);
    }

    const backendEntry = manifest.backend?.entry;
    if (!backendEntry) {
      throw new Error(`Plugin ${manifest.id} does not provide backend entry`);
    }

    const versionDir = resolvePluginVersionDir(manifest.id, manifest.version);
    const backendPath = joinPluginPath(versionDir, backendEntry);
    await access(backendPath);

    const executionContext: WorkerExecutionContext = {
      pluginId: manifest.id,
      userId: input.userId,
      projectKey: input.projectKey,
      permissions: {
        allowedHttpHosts: manifest.permissions?.allowedHttpHosts || [],
        maxExecutionMs: Math.max(
          1000,
          Math.min(
            pluginConfig.maxExecutionMs,
            Number(manifest.permissions?.maxExecutionMs || pluginConfig.maxExecutionMs),
          ),
        ),
      },
    };

    try {
      const result = await this.workerPool.execute(
        manifest.id,
        manifest.version,
        backendPath,
        input.operationId,
        input.args || {},
        executionContext,
        executionContext.permissions.maxExecutionMs,
      );

      await pluginInstallStore.appendAudit({
        userId: input.userId,
        pluginId: manifest.id,
        operationId: input.operationId,
        projectScope: input.projectKey,
        status: "ok",
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await pluginInstallStore.appendAudit({
        userId: input.userId,
        pluginId: manifest.id,
        operationId: input.operationId,
        projectScope: input.projectKey,
        status: "error",
        durationMs: Date.now() - startedAt,
        error: message,
      });
      throw err;
    }
  }

  async listOperationsForUser(userId: string): Promise<Array<{ pluginId: string; version: string; operations: PluginOperationDescriptor[] }>> {
    const plugins = await this.listUserPlugins(userId);
    const result: Array<{ pluginId: string; version: string; operations: PluginOperationDescriptor[] }> = [];

    for (const plugin of plugins) {
      if (!plugin.installation.enabled || plugin.installation.status !== "installed") {
        continue;
      }
      if (!plugin.manifest.backend?.entry || !plugin.manifest.capabilities.includes("doc.operation.execute")) {
        continue;
      }
      const operations = await this.listPluginOperations(plugin.manifest.id, plugin.manifest.version, plugin.manifest.backend.entry);
      result.push({
        pluginId: plugin.manifest.id,
        version: plugin.manifest.version,
        operations,
      });
    }

    return result;
  }

  async listEnabledCommandsForUser(userId: string): Promise<Array<PluginCommandDescriptor & { plugin_id: string }>> {
    const plugins = await this.listUserPlugins(userId);
    const commands: Array<PluginCommandDescriptor & { plugin_id: string }> = [];

    for (const plugin of plugins) {
      if (!plugin.installation.enabled || plugin.installation.status !== "installed") {
        continue;
      }
      for (const command of plugin.manifest.commands || []) {
        commands.push({
          ...command,
          plugin_id: plugin.manifest.id,
        });
      }
    }

    return commands.sort((a, b) => a.command.localeCompare(b.command));
  }

  dispose(): void {
    this.workerPool.dispose();
  }

  private async handleHostCall(
    context: WorkerExecutionContext,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (method) {
      case "getDocument": {
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
      case "saveDocument": {
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const doc = args.doc && typeof args.doc === "object"
          ? (args.doc as Record<string, unknown>)
          : null;
        if (!doc) {
          throw new Error("doc is required");
        }
        const saved = await documentStore.save(context.userId, projectKey, doc as never);
        return { meta: saved.meta, body: saved.body };
      }
      case "getAssetMeta": {
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const assetId = String(args.assetId || "").trim();
        if (!assetId) throw new Error("assetId is required");
        return await assetStore.getMeta(context.userId, projectKey, assetId);
      }
      case "getKnowledgeSources": {
        const projectKey = String(args.projectKey || context.projectKey).trim();
        const queryText = String(args.query || "").trim();
        const limit = Math.min(Math.max(1, Number(args.limit || 8)), 50);
        if (!queryText) {
          return { results: [] };
        }
        const searchResult = await knowledgeSearch.search(context.userId, projectKey, {
          mode: "hybrid",
          text: queryText,
          limit,
        });
        return searchResult;
      }
      case "fetchUrl": {
        const rawUrl = String(args.url || "").trim();
        if (!rawUrl) {
          throw new Error("url is required");
        }
        this.assertHostAllowed(context.permissions.allowedHttpHosts, rawUrl);

        const response = await fetch(rawUrl, {
          method: "GET",
          signal: AbortSignal.timeout(context.permissions.maxExecutionMs),
        });
        const text = await response.text();
        return {
          url: rawUrl,
          status: response.status,
          ok: response.ok,
          body: text.slice(0, 300000),
          headers: Object.fromEntries(response.headers.entries()),
        };
      }
      default:
        throw new Error(`Unsupported host method: ${method}`);
    }
  }

  private assertHostAllowed(allowedHosts: string[], targetUrl: string): void {
    if (!allowedHosts || allowedHosts.length === 0) {
      throw new Error("Plugin network access is denied by policy");
    }

    let host = "";
    try {
      const parsed = new URL(targetUrl);
      host = parsed.host;
    } catch {
      throw new Error("Invalid URL");
    }

    const matched = allowedHosts.some((allowed) => wildcardHostMatch(allowed, host));
    if (!matched) {
      throw new Error(`HTTP host is not allowed by plugin policy: ${host}`);
    }
  }

  private async refreshInstalledBlockTypes(): Promise<void> {
    const users = new Set<string>();
    // Cheap bootstrap: scan manifests under plugin root to register block ids.
    try {
      await access(pluginConfig.rootDir);
    } catch {
      return;
    }

    const installs = await queryAllInstalled();
    for (const row of installs) {
      users.add(row.userId);
    }

    for (const userId of users) {
      const plugins = await this.listUserPlugins(userId);
      for (const plugin of plugins) {
        this.registerManifestBlockTypes(plugin.manifest);
      }
    }
  }

  private registerManifestBlockTypes(manifest: PluginManifest): void {
    const blocks = manifest.contributions?.editorBlocks || [];
    if (blocks.length === 0) return;

    registerPluginBlockTypes(
      blocks.map((item) => ({
        blockType: item.blockType,
        requiresBlockId: item.requiresBlockId,
      })),
    );

    const blockIdTypes = blocks
      .filter((item) => item.requiresBlockId)
      .map((item) => item.blockType);
    registerBlockIdNodeTypes(blockIdTypes);
  }

  private async assertCommandConflicts(
    userId: string,
    pluginId: string,
    commands: PluginCommandDescriptor[],
  ): Promise<void> {
    const nextCommands = new Set(commands.map((item) => item.command));
    const reservedCommands = new Set(this.coreCommands);
    for (const skill of skillRegistry.getAllAnthropic()) {
      const command = String(skill.triggers.command || "").trim();
      if (command) {
        reservedCommands.add(command);
      }
    }

    for (const command of nextCommands) {
      if (reservedCommands.has(command)) {
        throw new Error(`Plugin command conflicts with built-in command: ${command}`);
      }
    }

    const installed = await this.listUserPlugins(userId);
    for (const plugin of installed) {
      if (plugin.manifest.id === pluginId) continue;
      for (const command of plugin.manifest.commands || []) {
        if (nextCommands.has(command.command)) {
          throw new Error(`Plugin command conflicts with installed plugin ${plugin.manifest.id}: ${command.command}`);
        }
      }
    }
  }

  private async extractToTemporaryRoot(
    pluginId: string,
    version: string,
    packageBuffer: Buffer,
  ): Promise<{ tmpDir: string; packageRoot: string }> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "zeus-plugin-"));
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
    const rootManifest = path.join(extractDir, "manifest.json");
    try {
      await access(rootManifest);
      return extractDir;
    } catch {
      // ignore
    }

    const packageManifest = path.join(extractDir, "package", "manifest.json");
    try {
      await access(packageManifest);
      return path.join(extractDir, "package");
    } catch {
      // ignore
    }

    throw new Error("Plugin package is missing manifest.json");
  }

  private buildFrontendEntryUrl(pluginId: string, version: string, entry: string): string {
    const normalized = normalizePathInsidePlugin(entry);
    const encodedEntry = normalized
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `/api/plugins/assets/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/${encodedEntry}`;
  }

  private async getManifestOrThrow(pluginId: string, version: string): Promise<PluginManifest> {
    const manifest = await this.loadManifestFromDisk(pluginId, version);
    if (!manifest) {
      throw new Error(`Manifest not found: ${pluginId}@${version}`);
    }
    return manifest;
  }

  private async loadManifestFromDisk(pluginId: string, version: string): Promise<PluginManifest | null> {
    const key = `${pluginId}@${version}`;
    const cached = this.manifestCache.get(key);
    if (cached) {
      return cached;
    }

    const manifestPath = path.join(resolvePluginVersionDir(pluginId, version), "manifest.json");
    try {
      const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      const manifest = parsePluginManifest(raw);
      validatePluginManifest(manifest, {
        appBackend: pluginConfig.appBackendVersion,
        web: pluginConfig.webVersion,
      });
      this.manifestCache.set(key, manifest);
      return manifest;
    } catch {
      return null;
    }
  }

  private async listPluginOperations(
    pluginId: string,
    version: string,
    backendEntry: string,
  ): Promise<PluginOperationDescriptor[]> {
    const cacheKey = `${pluginId}@${version}`;
    const cached = this.operationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const versionDir = resolvePluginVersionDir(pluginId, version);
    const backendPath = joinPluginPath(versionDir, backendEntry);
    const operationsRaw = await this.workerPool.listOperations(pluginId, version, backendPath);
    const operations = operationsRaw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const id = String(record.id || "").trim();
        if (!id) return null;
        return {
          id,
          title: String(record.title || id).trim(),
          description: String(record.description || id).trim(),
          riskLevel:
            record.riskLevel === "low" || record.riskLevel === "medium" || record.riskLevel === "high"
              ? record.riskLevel
              : "medium",
          requiresDocScope: record.requiresDocScope === true,
        };
      })
      .filter((item): item is PluginOperationDescriptor => Boolean(item));

    this.operationCache.set(cacheKey, operations);
    return operations;
  }
}

async function queryAllInstalled(): Promise<Array<{ userId: string; pluginId: string; version: string }>> {
  try {
    const result = await query<{
      user_id: string;
      plugin_id: string;
      version: string;
    }>(`
      SELECT user_id, plugin_id, version
        FROM plugin_user_installation
       WHERE status = 'installed' AND enabled = true
    `);
    return result.rows.map((row) => ({
      userId: row.user_id,
      pluginId: row.plugin_id,
      version: row.version,
    }));
  } catch {
    return [];
  }
}

export const pluginManager = new PluginManager();
