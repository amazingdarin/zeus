import path from "node:path";
import { ZEUS_DATA_ROOT, getUserPluginPackagesRoot } from "../storage/paths.js";

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export const pluginConfig = {
  rootDir: path.resolve(
    process.cwd(),
    process.env.PLUGIN_ROOT?.trim() || path.join(ZEUS_DATA_ROOT, "plugins", "packages"),
  ),
  storeIndexUrl: process.env.PLUGIN_STORE_INDEX_URL?.trim() || "",
  storeCatalogFile: process.env.PLUGIN_STORE_CATALOG_FILE?.trim() || "",
  storeTimeoutMs: parseNumber(process.env.PLUGIN_STORE_TIMEOUT_MS, 10000),
  requireSignature: parseBoolean(process.env.PLUGIN_STORE_REQUIRE_SIGNATURE, false),
  signaturePublicKeyPem: process.env.PLUGIN_STORE_PUBLIC_KEY_PEM?.trim() || "",
  maxExecutionMs: parseNumber(process.env.PLUGIN_MAX_EXECUTION_MS, 20000),
  workerIdleMs: parseNumber(process.env.PLUGIN_WORKER_IDLE_MS, 120000),
  appBackendVersion: process.env.PLUGIN_APP_BACKEND_VERSION?.trim() || "0.1.0",
  webVersion: process.env.PLUGIN_WEB_VERSION?.trim() || "0.1.0",
};

function getPluginPackageRoot(userId?: string): string {
  const explicitRoot = String(process.env.PLUGIN_ROOT || "").trim();
  if (explicitRoot) {
    return path.resolve(process.cwd(), explicitRoot);
  }
  if (userId) {
    return getUserPluginPackagesRoot(userId);
  }
  return pluginConfig.rootDir;
}

export function resolvePluginVersionDir(pluginId: string, version: string, userId?: string): string {
  const safePluginId = String(pluginId || "").trim();
  const safeVersion = String(version || "").trim();
  return path.join(getPluginPackageRoot(userId), safePluginId, safeVersion);
}
