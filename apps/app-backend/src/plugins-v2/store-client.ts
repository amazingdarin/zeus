import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type {
  PluginManifestV2,
  PluginStoreCatalog,
  PluginStorePluginSummary,
  PluginStoreVersionV2,
} from "@zeus/plugin-sdk-shared";

import { pluginConfig } from "../plugins/config.js";
import { parsePluginManifestV2 } from "./manifest.js";

type StoreVersionDocument = {
  version: string;
  packageUrl: string;
  manifest: unknown;
  publishedAt?: string;
};

type StorePluginDocument = {
  pluginId: string;
  displayName: string;
  description?: string;
  tags?: string[];
  versions: StoreVersionDocument[];
};

type StoreCatalogDocument = {
  plugins: StorePluginDocument[];
};

const execFileAsync = promisify(execFile);

async function pathStat(targetPath: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}

async function pathIsDirectory(targetPath: string): Promise<boolean> {
  const meta = await pathStat(targetPath);
  return Boolean(meta?.isDirectory());
}

export class PluginStoreClientV2 {
  private cache: { expiresAt: number; catalog: StoreCatalogDocument } | null = null;

  async listPlugins(query = ""): Promise<PluginStoreCatalog> {
    const catalog = await this.loadCatalog();
    const keyword = query.trim().toLowerCase();

    const plugins = catalog.plugins
      .filter((plugin) => {
        if (!keyword) return true;
        const haystack = `${plugin.pluginId} ${plugin.displayName} ${plugin.description || ""}`.toLowerCase();
        return haystack.includes(keyword);
      })
      .map((plugin): PluginStorePluginSummary => ({
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        description: plugin.description,
        latestVersion: plugin.versions[0]?.version || "",
        versions: plugin.versions.map((item) => item.version),
        tags: plugin.tags,
      }));

    return { plugins };
  }

  async getPluginVersions(pluginId: string): Promise<PluginStoreVersionV2[]> {
    const catalog = await this.loadCatalog();
    const plugin = catalog.plugins.find((item) => item.pluginId === pluginId);
    if (!plugin) {
      return [];
    }

    return plugin.versions.map((item) => ({
      pluginId: plugin.pluginId,
      version: item.version,
      packageUrl: item.packageUrl,
      manifest: parsePluginManifestV2(item.manifest),
      publishedAt: item.publishedAt,
    }));
  }

  async getManifest(pluginId: string, version: string): Promise<PluginManifestV2 | null> {
    const versions = await this.getPluginVersions(pluginId);
    const target = versions.find((item) => item.version === version);
    return target?.manifest ?? null;
  }

  async downloadPackage(pluginId: string, version: string): Promise<Buffer> {
    const versions = await this.getPluginVersions(pluginId);
    const target = versions.find((item) => item.version === version);
    if (!target) {
      throw new Error(`Plugin version not found: ${pluginId}@${version}`);
    }
    return this.fetchPackageBuffer(target.packageUrl);
  }

  private async loadCatalog(): Promise<StoreCatalogDocument> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.catalog;
    }

    let document: StoreCatalogDocument = await this.loadCatalogFromLocalDirectories();
    if (document.plugins.length === 0) {
      if (pluginConfig.storeCatalogFile) {
        const text = await readFile(pluginConfig.storeCatalogFile, "utf8");
        document = this.normalizeCatalog(JSON.parse(text) as unknown);
      } else if (pluginConfig.storeIndexUrl) {
        const response = await fetch(pluginConfig.storeIndexUrl, {
          method: "GET",
          signal: AbortSignal.timeout(pluginConfig.storeTimeoutMs),
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch plugin store catalog: ${response.status}`);
        }
        document = this.normalizeCatalog(await response.json() as unknown);
      }
    }

    this.cache = {
      catalog: document,
      expiresAt: now + 30000,
    };
    return document;
  }

  private normalizeCatalog(raw: unknown): StoreCatalogDocument {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const pluginsRaw = Array.isArray(value.plugins) ? value.plugins : [];

    const plugins: StorePluginDocument[] = [];
    for (const item of pluginsRaw) {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const pluginId = String(row.pluginId || "").trim();
      const displayName = String(row.displayName || pluginId).trim();
      const versionsRaw = Array.isArray(row.versions) ? row.versions : [];
      if (!pluginId || versionsRaw.length === 0) {
        continue;
      }

      const versions: StoreVersionDocument[] = [];
      for (const versionItem of versionsRaw) {
        const versionRow = versionItem && typeof versionItem === "object"
          ? versionItem as Record<string, unknown>
          : {};
        const version = String(versionRow.version || "").trim();
        const packageUrl = String(versionRow.packageUrl || "").trim();
        if (!version || !packageUrl || !versionRow.manifest) {
          continue;
        }
        versions.push({
          version,
          packageUrl,
          manifest: versionRow.manifest,
          publishedAt: typeof versionRow.publishedAt === "string" ? versionRow.publishedAt : undefined,
        });
      }

      versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
      if (versions.length === 0) {
        continue;
      }

      plugins.push({
        pluginId,
        displayName,
        description: typeof row.description === "string" ? row.description : undefined,
        tags: Array.isArray(row.tags)
          ? row.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
          : undefined,
        versions,
      });
    }

    return { plugins };
  }

  private resolveLocalPluginRoots(): string[] {
    const roots = new Set<string>();
    const addRoot = (value: string | undefined) => {
      const raw = String(value || "").trim();
      if (!raw) return;
      roots.add(path.resolve(process.cwd(), raw));
    };

    addRoot(process.env.PLUGIN_STORE_LOCAL_ROOT);
    addRoot("data/plugins");
    addRoot("../../data/plugins");
    addRoot("data/plugins/packages");
    addRoot(pluginConfig.rootDir);

    return Array.from(roots);
  }

  private async resolveManifestPath(versionRoot: string): Promise<string | null> {
    const candidates = [
      path.join(versionRoot, "manifest.v2.json"),
      path.join(versionRoot, "manifest.json"),
    ];
    for (const candidate of candidates) {
      const meta = await pathStat(candidate);
      if (meta?.isFile()) {
        return candidate;
      }
    }
    return null;
  }

  private async loadCatalogFromLocalDirectories(): Promise<StoreCatalogDocument> {
    const pluginMap = new Map<
      string,
      {
        pluginId: string;
        displayName: string;
        description?: string;
        versions: Map<string, StoreVersionDocument>;
      }
    >();

    for (const root of this.resolveLocalPluginRoots()) {
      if (!(await pathIsDirectory(root))) {
        continue;
      }

      let pluginDirs: Dirent<string>[];
      try {
        pluginDirs = await readdir(root, { withFileTypes: true, encoding: "utf8" });
      } catch {
        continue;
      }

      for (const pluginDir of pluginDirs) {
        if (!pluginDir.isDirectory()) continue;
        const pluginIdFromDir = String(pluginDir.name || "").trim();
        if (!pluginIdFromDir) continue;

        const pluginRoot = path.join(root, pluginIdFromDir);
        let versionDirs: Dirent<string>[];
        try {
          versionDirs = await readdir(pluginRoot, { withFileTypes: true, encoding: "utf8" });
        } catch {
          continue;
        }

        for (const versionDir of versionDirs) {
          if (!versionDir.isDirectory()) continue;
          const versionRoot = path.join(pluginRoot, versionDir.name);
          const manifestPath = await this.resolveManifestPath(versionRoot);
          if (!manifestPath) continue;

          let manifestRaw: unknown;
          try {
            manifestRaw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
          } catch {
            continue;
          }

          let manifest: PluginManifestV2;
          try {
            manifest = parsePluginManifestV2(manifestRaw);
          } catch {
            continue;
          }

          const pluginId = String(manifest.id || pluginIdFromDir).trim();
          if (!pluginId || pluginId !== pluginIdFromDir) {
            continue;
          }
          const version = String(manifest.version || versionDir.name).trim();
          if (!version) continue;

          const publishedAt = (await pathStat(manifestPath))?.mtime.toISOString();
          const existing = pluginMap.get(pluginId) || {
            pluginId,
            displayName: String(manifest.displayName || pluginId).trim() || pluginId,
            description: manifest.description,
            versions: new Map<string, StoreVersionDocument>(),
          };
          if (!existing.versions.has(version)) {
            existing.versions.set(version, {
              version,
              packageUrl: versionRoot,
              manifest,
              publishedAt,
            });
          }
          pluginMap.set(pluginId, existing);
        }
      }
    }

    const plugins: StorePluginDocument[] = [];
    for (const [, plugin] of pluginMap) {
      const versions = Array.from(plugin.versions.values())
        .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
      if (versions.length === 0) continue;
      plugins.push({
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        description: plugin.description,
        versions,
      });
    }

    return { plugins };
  }

  private async packageDirectoryToTgz(directoryPath: string): Promise<Buffer> {
    const { stdout } = await execFileAsync(
      "tar",
      ["-czf", "-", "-C", directoryPath, "."],
      {
        encoding: "buffer",
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  }

  private async readPackageFromLocalPath(localPath: string): Promise<Buffer> {
    const targetPath = path.resolve(localPath);
    const meta = await pathStat(targetPath);
    if (!meta) {
      throw new Error(`Package path not found: ${targetPath}`);
    }
    if (meta.isDirectory()) {
      return this.packageDirectoryToTgz(targetPath);
    }
    return Buffer.from(await readFile(targetPath));
  }

  private async fetchPackageBuffer(packageUrl: string): Promise<Buffer> {
    if (!packageUrl) {
      throw new Error("Invalid package URL");
    }

    if (packageUrl.startsWith("file://")) {
      return this.readPackageFromLocalPath(fileURLToPath(new URL(packageUrl)));
    }

    if (/^https?:\/\//i.test(packageUrl)) {
      const response = await fetch(packageUrl, {
        method: "GET",
        signal: AbortSignal.timeout(pluginConfig.storeTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Failed to download plugin package: ${response.status}`);
      }
      return Buffer.from(await response.arrayBuffer());
    }

    return this.readPackageFromLocalPath(packageUrl);
  }
}

export const pluginStoreClientV2 = new PluginStoreClientV2();
