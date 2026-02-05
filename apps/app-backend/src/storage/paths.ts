/**
 * Storage path utilities for Zeus app-backend
 * 
 * Directory structure:
 * - Personal projects: /{userId}/personal/{projectKey}/docs/...
 * - Team projects (future): /{userId}/team/{teamId}/{projectKey}/docs/...
 */

import path from "node:path";

/**
 * Project owner type
 * - personal: User's personal project
 * - team: Team shared project (future)
 */
export type ProjectOwnerType = "personal" | "team";

/**
 * Root directory for all repository data
 */
export const REPO_ROOT = process.env.REPO_ROOT || "./data/repos";

/**
 * Get the root path for a project
 * 
 * @param userId - The user ID
 * @param ownerType - The project owner type (personal or team)
 * @param projectKey - The project key
 * @returns The full path to the project root
 */
export function getProjectRoot(
  userId: string,
  ownerType: ProjectOwnerType,
  projectKey: string
): string {
  return path.join(REPO_ROOT, userId, ownerType, projectKey);
}

/**
 * Get the docs directory path for a project
 * 
 * @param userId - The user ID
 * @param ownerType - The project owner type
 * @param projectKey - The project key
 * @returns The full path to the docs directory
 */
export function getDocsRoot(
  userId: string,
  ownerType: ProjectOwnerType,
  projectKey: string
): string {
  return path.join(getProjectRoot(userId, ownerType, projectKey), "docs");
}

/**
 * Get the assets directory path for a project
 * 
 * @param userId - The user ID
 * @param ownerType - The project owner type
 * @param projectKey - The project key
 * @returns The full path to the assets directory
 */
export function getAssetsRoot(
  userId: string,
  ownerType: ProjectOwnerType,
  projectKey: string
): string {
  return path.join(getProjectRoot(userId, ownerType, projectKey), "assets");
}

/**
 * Build a cache key for project-scoped caches
 * 
 * @param userId - The user ID
 * @param projectKey - The project key
 * @returns A unique cache key
 */
export function buildCacheKey(userId: string, projectKey: string): string {
  return `${userId}:${projectKey}`;
}
