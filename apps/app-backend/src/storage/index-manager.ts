import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { CachedDoc, Document } from "./types.js";

/**
 * In-memory index manager for document metadata.
 * Maintains a cache of document IDs to their paths, titles, and parent IDs.
 * Also manages .index files for document ordering within directories.
 * 
 * Cache keys are in the format "{userId}:{projectKey}" to support
 * user-isolated project storage.
 */
export class IndexManager {
  private indexes: Map<string, Map<string, CachedDoc>> = new Map();
  private initialized: Set<string> = new Set();

  /**
   * Ensure the index is built for a project
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   * @param docsRoot - The docs root path for the project
   */
  async ensure(cacheKey: string, docsRoot: string): Promise<void> {
    if (this.initialized.has(cacheKey)) {
      return;
    }
    await this.buildIndex(cacheKey, docsRoot);
    this.initialized.add(cacheKey);
  }

  /**
   * Get a cached document by ID
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   * @param docId - The document ID
   */
  get(cacheKey: string, docId: string): CachedDoc | undefined {
    return this.indexes.get(cacheKey)?.get(docId);
  }

  /**
   * Update or add a document to the index
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   * @param docId - The document ID
   * @param doc - The cached document data
   */
  update(cacheKey: string, docId: string, doc: CachedDoc): void {
    let projectIndex = this.indexes.get(cacheKey);
    if (!projectIndex) {
      projectIndex = new Map();
      this.indexes.set(cacheKey, projectIndex);
    }
    projectIndex.set(docId, doc);
  }

  /**
   * Remove a document from the index
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   * @param docId - The document ID
   */
  remove(cacheKey: string, docId: string): void {
    this.indexes.get(cacheKey)?.delete(docId);
  }

  /**
   * Get all document IDs for a project
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   */
  getAllIds(cacheKey: string): string[] {
    const projectIndex = this.indexes.get(cacheKey);
    if (!projectIndex) return [];
    return Array.from(projectIndex.keys());
  }

  /**
   * Get all cached documents for a project
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   */
  getAll(cacheKey: string): Map<string, CachedDoc> {
    return this.indexes.get(cacheKey) || new Map();
  }

  /**
   * Build title path for a document (e.g., "父文档/子文档/当前文档")
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   * @param docId - The document ID
   */
  buildTitlePath(cacheKey: string, docId: string): string {
    const projectIndex = this.indexes.get(cacheKey);
    if (!projectIndex) return "";

    const parts: string[] = [];
    const visited = new Set<string>();
    let currentId = docId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const cached = projectIndex.get(currentId);
      if (!cached) break;

      parts.unshift(cached.title);

      const parentId = cached.parentId?.trim();
      if (!parentId || parentId === "root") break;
      currentId = parentId;
    }

    return parts.join("/");
  }

  /**
   * Find document ID by its path
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   * @param docPath - The document path
   */
  findIdByPath(cacheKey: string, docPath: string): string | undefined {
    const projectIndex = this.indexes.get(cacheKey);
    if (!projectIndex) return undefined;
    for (const [id, cached] of projectIndex) {
      if (cached.path === docPath) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Build the index by scanning the project directory
   */
  private async buildIndex(cacheKey: string, docsRoot: string): Promise<void> {
    const projectIndex = new Map<string, CachedDoc>();
    this.indexes.set(cacheKey, projectIndex);

    try {
      await this.scanDirectory(docsRoot, projectIndex);
    } catch (err) {
      // Directory might not exist yet
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  /**
   * Recursively scan a directory for document JSON files
   */
  private async scanDirectory(
    dir: string,
    projectIndex: Map<string, CachedDoc>,
    basePath = "",
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;

      const fullPath = path.join(dir, entry);
      const stats = await stat(fullPath).catch(() => null);
      if (!stats) continue;

      if (stats.isDirectory()) {
        await this.scanDirectory(fullPath, projectIndex, path.join(basePath, entry));
      } else if (entry.endsWith(".json")) {
        try {
          const content = await readFile(fullPath, "utf-8");
          const doc = JSON.parse(content) as Document;
          if (doc.meta?.id) {
            const relPath = path.join(basePath, entry);
            projectIndex.set(doc.meta.id, {
              path: relPath,
              title: doc.meta.title || "",
              parentId: doc.meta.parent_id || "",
            });
          }
        } catch {
          // Skip invalid JSON files
        }
      }
    }
  }

  /**
   * Read the .index file for a directory
   */
  async readIndexFile(dir: string): Promise<string[]> {
    try {
      const content = await readFile(path.join(dir, ".index"), "utf-8");
      const entries = JSON.parse(content);
      if (Array.isArray(entries)) {
        return entries.filter((e) => typeof e === "string" && e.trim());
      }
    } catch {
      // File doesn't exist or invalid JSON
    }
    return [];
  }

  /**
   * Write the .index file for a directory
   */
  async writeIndexFile(dir: string, docIds: string[]): Promise<void> {
    await writeFile(path.join(dir, ".index"), JSON.stringify(docIds), "utf-8");
  }

  /**
   * Add a document ID to a directory's index file
   * @param cacheKey - The cache key (not used but kept for API consistency)
   * @param dir - The directory path
   * @param docId - The document ID to add
   */
  async addToIndexFile(cacheKey: string, dir: string, docId: string): Promise<void> {
    const ids = await this.readIndexFile(dir);
    if (ids.includes(docId)) return;
    ids.push(docId);
    await this.writeIndexFile(dir, ids);
  }

  /**
   * Remove a document ID from a directory's index file
   */
  async removeFromIndexFile(dir: string, docId: string): Promise<void> {
    const ids = await this.readIndexFile(dir);
    const filtered = ids.filter((id) => id !== docId);
    await this.writeIndexFile(dir, filtered);
  }

  /**
   * Reorder index file, optionally inserting a doc at a specific position
   */
  async reorderIndexFile(
    dir: string,
    docId: string,
    beforeDocId: string | undefined,
    afterDocId: string | undefined,
    insert: boolean,
  ): Promise<void> {
    let ids = await this.readIndexFile(dir);
    ids = ids.filter((id) => id !== docId);

    if (!insert) {
      await this.writeIndexFile(dir, ids);
      return;
    }

    let insertAt = ids.length;
    if (beforeDocId) {
      const idx = ids.indexOf(beforeDocId);
      if (idx >= 0) insertAt = idx;
    } else if (afterDocId) {
      const idx = ids.indexOf(afterDocId);
      if (idx >= 0) insertAt = idx + 1;
    }

    ids.splice(insertAt, 0, docId);
    await this.writeIndexFile(dir, ids);
  }

  /**
   * Collect IDs from JSON files in a directory that aren't in the seen set
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   * @param dir - The directory to scan
   * @param seen - Set of already seen IDs
   */
  async collectIdsFromDir(
    cacheKey: string,
    dir: string,
    seen: Set<string>,
  ): Promise<string[]> {
    const ids: string[] = [];
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const fullPath = path.join(dir, entry);
        try {
          const content = await readFile(fullPath, "utf-8");
          const doc = JSON.parse(content) as Document;
          const id = doc.meta?.id?.trim();
          if (id && !seen.has(id) && this.get(cacheKey, id)) {
            ids.push(id);
            seen.add(id);
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory might not exist
    }
    return ids;
  }

  /**
   * Get ordered children from a directory, repairing index if needed
   * @param cacheKey - The cache key (format: "{userId}:{projectKey}")
   * @param dir - The directory to get children from
   */
  async getOrderedChildren(cacheKey: string, dir: string): Promise<string[]> {
    let order = await this.readIndexFile(dir);
    const projectIndex = this.indexes.get(cacheKey);

    // Validate and filter entries
    const seen = new Set<string>();
    const resolved: string[] = [];
    let changed = false;

    for (const id of order) {
      const trimmed = id.trim();
      if (!trimmed || seen.has(trimmed)) {
        changed = true;
        continue;
      }
      if (!projectIndex?.has(trimmed)) {
        changed = true;
        continue;
      }
      seen.add(trimmed);
      resolved.push(trimmed);
    }

    // Add any missing documents from directory
    const repaired = await this.collectIdsFromDir(cacheKey, dir, seen);
    if (repaired.length > 0) {
      resolved.push(...repaired);
      changed = true;
    }

    if (changed) {
      await this.writeIndexFile(dir, resolved);
    }

    return resolved;
  }
}

// Singleton instance
export const indexManager = new IndexManager();
