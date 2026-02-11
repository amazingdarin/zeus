/**
 * Storage path utilities for Zeus app-backend
 *
 * v2 user-local layout:
 * ${ZEUS_DATA_ROOT}/
 *   users/{userId}/
 *     projects/{ownerType}/{ownerId}/{projectKey}/
 *       docs/
 *       assets/
 *     .plugin/
 *       packages/{pluginId}/{version}/
 *       settings/{pluginId}.json
 *       data/global/{pluginId}/
 *       data/projects/{ownerType}/{ownerId}/{projectKey}/{pluginId}/
 *       cache/{pluginId}/
 *       runtime/
 *       tmp/
 *       installed.json
 *       registry-snapshot.json
 */

import path from "node:path";

import { resolveProjectScope, type ProjectOwnerType } from "../project-scope.js";

export type { ProjectOwnerType };

export type ProjectLocation = {
  ownerType: ProjectOwnerType;
  ownerId: string;
  ownerProjectKey: string;
  scopedProjectKey: string;
};

function inferDataRoot(): string {
  const explicit = String(process.env.ZEUS_DATA_ROOT || "").trim();
  if (explicit) {
    return path.resolve(process.cwd(), explicit);
  }

  const legacyRepoRoot = String(process.env.REPO_ROOT || "").trim();
  if (legacyRepoRoot) {
    const resolvedLegacy = path.resolve(process.cwd(), legacyRepoRoot);
    // Compatible with historical REPO_ROOT=.../data/repos
    if (path.basename(resolvedLegacy) === "repos") {
      return path.dirname(resolvedLegacy);
    }
    return resolvedLegacy;
  }

  return path.resolve(process.cwd(), "./data");
}

function safeSegment(value: string, fallback: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return fallback;
  }
  return encodeURIComponent(raw);
}

export const ZEUS_DATA_ROOT = inferDataRoot();
export const USERS_ROOT = path.join(ZEUS_DATA_ROOT, "users");

/**
 * Backward-compat alias for historical naming.
 */
export const REPO_ROOT = ZEUS_DATA_ROOT;

export function resolveProjectLocation(userId: string, projectKey: string): ProjectLocation {
  const scope = resolveProjectScope(userId, projectKey);
  return {
    ownerType: scope.ownerType,
    ownerId: scope.ownerId,
    ownerProjectKey: scope.projectKey,
    scopedProjectKey: scope.scopedProjectKey,
  };
}

export function getUserRoot(userId: string): string {
  return path.join(USERS_ROOT, safeSegment(userId, "anonymous"));
}

export function getUserProjectsRoot(userId: string): string {
  return path.join(getUserRoot(userId), "projects");
}

export function getProjectRoot(
  userId: string,
  ownerId: string,
  ownerType: ProjectOwnerType,
  projectKey: string,
): string {
  return path.join(
    getUserProjectsRoot(userId),
    safeSegment(ownerType, "personal"),
    safeSegment(ownerId, "owner"),
    safeSegment(projectKey, "project"),
  );
}

export function getDocsRoot(
  userId: string,
  ownerId: string,
  ownerType: ProjectOwnerType,
  projectKey: string,
): string {
  return path.join(getProjectRoot(userId, ownerId, ownerType, projectKey), "docs");
}

export function getAssetsRoot(
  userId: string,
  ownerId: string,
  ownerType: ProjectOwnerType,
  projectKey: string,
): string {
  return path.join(getProjectRoot(userId, ownerId, ownerType, projectKey), "assets");
}

export function getScopedDocsRoot(userId: string, projectKey: string): string {
  const location = resolveProjectLocation(userId, projectKey);
  return getDocsRoot(userId, location.ownerId, location.ownerType, location.ownerProjectKey);
}

export function getScopedAssetsRoot(userId: string, projectKey: string): string {
  const location = resolveProjectLocation(userId, projectKey);
  return getAssetsRoot(userId, location.ownerId, location.ownerType, location.ownerProjectKey);
}

export function getUserPluginRoot(userId: string): string {
  return path.join(getUserRoot(userId), ".plugin");
}

export function getUserPluginPackagesRoot(userId: string): string {
  return path.join(getUserPluginRoot(userId), "packages");
}

export function getUserPluginSettingsDir(userId: string): string {
  return path.join(getUserPluginRoot(userId), "settings");
}

export function getUserPluginSettingsPath(userId: string, pluginId: string): string {
  return path.join(
    getUserPluginSettingsDir(userId),
    `${safeSegment(pluginId, "plugin")}.json`,
  );
}

export function getUserPluginDataRoot(userId: string): string {
  return path.join(getUserPluginRoot(userId), "data");
}

export function getUserPluginDataGlobalRoot(userId: string, pluginId?: string): string {
  const base = path.join(getUserPluginDataRoot(userId), "global");
  if (!pluginId) {
    return base;
  }
  return path.join(base, safeSegment(pluginId, "plugin"));
}

export function getUserPluginDataProjectRoot(
  userId: string,
  projectKey: string,
  pluginId?: string,
): string {
  const location = resolveProjectLocation(userId, projectKey);
  const base = path.join(
    getUserPluginDataRoot(userId),
    "projects",
    safeSegment(location.ownerType, "personal"),
    safeSegment(location.ownerId, "owner"),
    safeSegment(location.ownerProjectKey, "project"),
  );
  if (!pluginId) {
    return base;
  }
  return path.join(base, safeSegment(pluginId, "plugin"));
}

export function getUserPluginCacheRoot(userId: string, pluginId?: string): string {
  const base = path.join(getUserPluginRoot(userId), "cache");
  if (!pluginId) {
    return base;
  }
  return path.join(base, safeSegment(pluginId, "plugin"));
}

export function getUserPluginRuntimeRoot(userId: string): string {
  return path.join(getUserPluginRoot(userId), "runtime");
}

export function getUserPluginTmpRoot(userId: string): string {
  return path.join(getUserPluginRoot(userId), "tmp");
}

export function getUserPluginInstalledConfigPath(userId: string): string {
  return path.join(getUserPluginRoot(userId), "installed.json");
}

export function getUserPluginRegistrySnapshotPath(userId: string): string {
  return path.join(getUserPluginRoot(userId), "registry-snapshot.json");
}

/**
 * Build a cache key for project-scoped caches
 */
export function buildCacheKey(userId: string, projectKey: string): string {
  const location = resolveProjectLocation(userId, projectKey);
  return `${location.ownerType}:${location.ownerId}:${location.ownerProjectKey}`;
}
