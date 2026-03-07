import { readFile } from "node:fs/promises";

import type {
  PluginManifest,
  PluginStoreCatalog,
  PluginStorePluginSummary,
  PluginStoreVersion,
} from "@zeus/plugin-sdk-shared";

import { pluginConfig } from "./config.js";
import { parsePluginManifest } from "./manifest.js";

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

export class PluginStoreClient {
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

  async getPluginVersions(pluginId: string): Promise<PluginStoreVersion[]> {
    const catalog = await this.loadCatalog();
    const plugin = catalog.plugins.find((item) => item.pluginId === pluginId);
    if (!plugin) {
      return [];
    }

    return plugin.versions.map((item) => ({
      pluginId: plugin.pluginId,
      version: item.version,
      packageUrl: item.packageUrl,
      manifest: parsePluginManifest(item.manifest),
      publishedAt: item.publishedAt,
    }));
  }

  async downloadPackage(pluginId: string, version: string): Promise<Buffer> {
    const versions = await this.getPluginVersions(pluginId);
    const target = versions.find((item) => item.version === version);
    if (!target) {
      throw new Error(`Plugin version not found: ${pluginId}@${version}`);
    }

    return this.fetchPackageBuffer(target.packageUrl);
  }

  async getManifest(pluginId: string, version: string): Promise<PluginManifest | null> {
    const versions = await this.getPluginVersions(pluginId);
    const target = versions.find((item) => item.version === version);
    return target?.manifest ?? null;
  }

  private async loadCatalog(): Promise<StoreCatalogDocument> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.catalog;
    }

    let document: StoreCatalogDocument | null = null;
    if (pluginConfig.storeCatalogFile) {
      const text = await readFile(pluginConfig.storeCatalogFile, "utf8");
      const parsed = JSON.parse(text) as unknown;
      document = this.normalizeCatalog(parsed);
    } else if (pluginConfig.storeIndexUrl) {
      const response = await fetch(pluginConfig.storeIndexUrl, {
        method: "GET",
        signal: AbortSignal.timeout(pluginConfig.storeTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch plugin store catalog: ${response.status}`);
      }
      const parsed = await response.json() as unknown;
      document = this.normalizeCatalog(parsed);
    }

    if (!document) {
      return { plugins: [] };
    }

    this.cache = {
      catalog: document,
      expiresAt: now + 30000,
    };
    return document;
  }

  private normalizeCatalog(raw: unknown): StoreCatalogDocument {
    const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const plugins = Array.isArray(value.plugins) ? value.plugins : [];

    const normalizedPlugins: StorePluginDocument[] = [];
    for (const item of plugins) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const pluginId = String(entry.pluginId || "").trim();
      const displayName = String(entry.displayName || pluginId).trim();
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      if (!pluginId || versions.length === 0) {
        continue;
      }

      const normalizedVersions: StoreVersionDocument[] = [];
      for (const versionItem of versions) {
        if (!versionItem || typeof versionItem !== "object") continue;
        const record = versionItem as Record<string, unknown>;
        const version = String(record.version || "").trim();
        const packageUrl = String(record.packageUrl || "").trim();
        if (!version || !packageUrl || !record.manifest) {
          continue;
        }
        normalizedVersions.push({
          version,
          packageUrl,
          manifest: record.manifest,
          publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : undefined,
        });
      }
      normalizedVersions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
      if (normalizedVersions.length === 0) {
        continue;
      }

      normalizedPlugins.push({
        pluginId,
        displayName,
        description: typeof entry.description === "string" ? entry.description : undefined,
        tags: Array.isArray(entry.tags)
          ? entry.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
          : undefined,
        versions: normalizedVersions,
      });
    }

    return { plugins: normalizedPlugins };
  }

  private async fetchPackageBuffer(packageUrl: string): Promise<Buffer> {
    if (!packageUrl) {
      throw new Error("Invalid package URL");
    }

    if (packageUrl.startsWith("file://")) {
      const filePath = new URL(packageUrl);
      const data = await readFile(filePath);
      return Buffer.from(data);
    }

    if (/^https?:\/\//i.test(packageUrl)) {
      const response = await fetch(packageUrl, {
        method: "GET",
        signal: AbortSignal.timeout(pluginConfig.storeTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Failed to download plugin package: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    const data = await readFile(packageUrl);
    return Buffer.from(data);
  }
}

export const pluginStoreClient = new PluginStoreClient();
