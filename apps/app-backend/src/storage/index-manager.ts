import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { CachedDoc, Document } from "./types.js";

/**
 * In-memory index manager for document metadata.
 * Maintains a cache of document IDs to their paths, titles, and parent IDs.
 * Also manages .index files for document ordering within directories.
 */
export class IndexManager {
  private indexes: Map<string, Map<string, CachedDoc>> = new Map();
  private initialized: Set<string> = new Set();

  /**
   * Ensure the index is built for a project
   */
  async ensure(projectKey: string, projectRoot: string): Promise<void> {
    if (this.initialized.has(projectKey)) {
      return;
    }
    await this.buildIndex(projectKey, projectRoot);
    this.initialized.add(projectKey);
  }

  /**
   * Get a cached document by ID
   */
  get(projectKey: string, docId: string): CachedDoc | undefined {
    return this.indexes.get(projectKey)?.get(docId);
  }

  /**
   * Update or add a document to the index
   */
  update(projectKey: string, docId: string, doc: CachedDoc): void {
    let projectIndex = this.indexes.get(projectKey);
    if (!projectIndex) {
      projectIndex = new Map();
      this.indexes.set(projectKey, projectIndex);
    }
    projectIndex.set(docId, doc);
  }

  /**
   * Remove a document from the index
   */
  remove(projectKey: string, docId: string): void {
    this.indexes.get(projectKey)?.delete(docId);
  }

  /**
   * Get all document IDs for a project
   */
  getAllIds(projectKey: string): string[] {
    const projectIndex = this.indexes.get(projectKey);
    if (!projectIndex) return [];
    return Array.from(projectIndex.keys());
  }

  /**
   * Find document ID by its path
   */
  findIdByPath(projectKey: string, docPath: string): string | undefined {
    const projectIndex = this.indexes.get(projectKey);
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
  private async buildIndex(projectKey: string, projectRoot: string): Promise<void> {
    const projectIndex = new Map<string, CachedDoc>();
    this.indexes.set(projectKey, projectIndex);

    try {
      await this.scanDirectory(projectRoot, projectIndex);
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
   */
  async addToIndexFile(projectKey: string, dir: string, docId: string): Promise<void> {
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
   */
  async collectIdsFromDir(
    projectKey: string,
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
          if (id && !seen.has(id) && this.get(projectKey, id)) {
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
   */
  async getOrderedChildren(projectKey: string, dir: string): Promise<string[]> {
    let order = await this.readIndexFile(dir);
    const projectIndex = this.indexes.get(projectKey);

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
    const repaired = await this.collectIdsFromDir(projectKey, dir, seen);
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
