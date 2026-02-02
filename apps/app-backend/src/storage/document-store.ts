import { mkdir, readFile, writeFile, rm, rename, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

import { indexManager } from "./index-manager.js";
import type { Document, DocumentMeta, TreeItem, CachedDoc } from "./types.js";

const REPO_ROOT = process.env.REPO_ROOT || "./data/repos";

export class DocumentNotFoundError extends Error {
  constructor(docId: string) {
    super(`Document not found: ${docId}`);
    this.name = "DocumentNotFoundError";
  }
}

export class BlockNotFoundError extends Error {
  constructor(blockId: string) {
    super(`Block not found: ${blockId}`);
    this.name = "BlockNotFoundError";
  }
}

/**
 * Get the root path for a project
 */
function projectRoot(projectKey: string): string {
  return path.join(REPO_ROOT, projectKey);
}

/**
 * Normalize a title to a URL-friendly slug
 */
function normalizeSlug(title: string): string {
  const s = title.trim().toLowerCase();
  if (!s) return "";

  let result = "";
  let prevDash = false;

  for (const char of s) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      result += char;
      prevDash = false;
    } else if (char === "-" || char === "_" || /\s/.test(char)) {
      if (!prevDash && result.length > 0) {
        result += "-";
        prevDash = true;
      }
    } else {
      if (!prevDash && result.length > 0) {
        result += "-";
        prevDash = true;
      }
    }
  }

  return result.replace(/^-+|-+$/g, "");
}

/**
 * Ensure a unique slug in the target directory
 */
async function ensureUniqueSlug(dir: string, slug: string): Promise<string> {
  let current = slug;
  let count = 1;

  while (true) {
    const filename = `${current}.json`;
    const filePath = path.join(dir, filename);
    try {
      await stat(filePath);
      // File exists, try next
      current = `${slug}-${count}`;
      count++;
    } catch {
      // File doesn't exist, use this slug
      return current;
    }
  }
}

/**
 * Rename a document file and its companion directory
 */
async function renameFileAndDir(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath);

  const ext = path.extname(oldPath);
  const oldDir = oldPath.slice(0, -ext.length);
  const newDir = newPath.slice(0, -ext.length);

  try {
    const stats = await stat(oldDir);
    if (stats.isDirectory()) {
      await rename(oldDir, newDir);
    }
  } catch {
    // Companion directory doesn't exist
  }
}

export const documentStore = {
  /**
   * Get a document by ID
   */
  async get(projectKey: string, docId: string): Promise<Document> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    const cached = indexManager.get(projectKey, docId);
    if (!cached) {
      throw new DocumentNotFoundError(docId);
    }

    const fullPath = path.join(root, cached.path);
    try {
      const content = await readFile(fullPath, "utf-8");
      return JSON.parse(content) as Document;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        indexManager.remove(projectKey, docId);
        throw new DocumentNotFoundError(docId);
      }
      throw err;
    }
  },

  /**
   * Save a document (create or update)
   */
  async save(projectKey: string, doc: Document): Promise<Document> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    // Ensure ID
    if (!doc.meta.id) {
      doc.meta.id = uuidv4();
    }

    const cached = indexManager.get(projectKey, doc.meta.id);
    const exists = !!cached;

    // Determine target directory
    let targetDir: string;
    if (exists && cached) {
      const currentPath = path.join(root, cached.path);
      targetDir = path.dirname(currentPath);
    } else {
      const parentId = doc.meta.parent_id;
      if (parentId && parentId !== "root") {
        const parentCache = indexManager.get(projectKey, parentId);
        if (!parentCache) {
          throw new Error("Parent document not found");
        }
        const parentPath = path.join(root, parentCache.path);
        const ext = path.extname(parentPath);
        targetDir = parentPath.slice(0, -ext.length);
      } else {
        targetDir = path.join(root, "docs");
      }
    }

    // Generate slug
    if (!doc.meta.slug) {
      doc.meta.slug = normalizeSlug(doc.meta.title) || doc.meta.id.trim();
    }

    // Ensure unique slug
    let finalSlug: string;
    if (exists && cached) {
      const currentSlug = path.basename(cached.path, ".json");
      if (currentSlug === doc.meta.slug) {
        finalSlug = currentSlug;
      } else {
        finalSlug = await ensureUniqueSlug(targetDir, doc.meta.slug);
      }
    } else {
      finalSlug = await ensureUniqueSlug(targetDir, doc.meta.slug);
    }
    doc.meta.slug = finalSlug;

    // Create directory if needed
    await mkdir(targetDir, { recursive: true });

    const filename = `${finalSlug}.json`;
    const fullPath = path.join(targetDir, filename);

    // Handle file rename if path changed
    if (exists && cached) {
      const oldFullPath = path.join(root, cached.path);
      if (oldFullPath !== fullPath) {
        await renameFileAndDir(oldFullPath, fullPath);
        const oldDir = path.dirname(oldFullPath);
        if (oldDir !== targetDir) {
          await indexManager.removeFromIndexFile(oldDir, doc.meta.id);
        }
      }
    }

    // Add to index file
    await indexManager.addToIndexFile(projectKey, targetDir, doc.meta.id);

    // Update metadata
    const relPath = path.relative(root, fullPath);
    doc.meta.path = relPath;
    doc.meta.updated_at = new Date().toISOString();
    if (!doc.meta.created_at) {
      doc.meta.created_at = doc.meta.updated_at;
    }
    if (!doc.meta.schema_version) {
      doc.meta.schema_version = "v1";
    }

    // Write file
    await writeFile(fullPath, JSON.stringify(doc, null, 2), "utf-8");

    // Update in-memory index
    indexManager.update(projectKey, doc.meta.id, {
      path: relPath,
      title: doc.meta.title,
      parentId: doc.meta.parent_id || "",
    });

    return doc;
  },

  /**
   * Delete a document (optionally recursive)
   * Returns the list of deleted document IDs
   */
  async delete(projectKey: string, docId: string, recursive = false): Promise<string[]> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    const cached = indexManager.get(projectKey, docId);
    if (!cached) {
      throw new DocumentNotFoundError(docId);
    }

    const deletedIds: string[] = [];

    // If recursive, delete children first
    if (recursive) {
      const childIds = await this.collectAllDescendantIds(projectKey, docId);
      // Delete from bottom-up (children first)
      for (const childId of childIds.reverse()) {
        await this.deleteSingle(projectKey, childId);
        deletedIds.push(childId);
      }
    }

    // Delete the document itself
    await this.deleteSingle(projectKey, docId);
    deletedIds.push(docId);

    return deletedIds;
  },

  /**
   * Collect all descendant document IDs (for recursive deletion)
   */
  async collectAllDescendantIds(projectKey: string, parentId: string): Promise<string[]> {
    const children = await this.getChildren(projectKey, parentId);
    const ids: string[] = [];

    for (const child of children) {
      ids.push(child.id);
      // Recursively collect descendants
      const descendants = await this.collectAllDescendantIds(projectKey, child.id);
      ids.push(...descendants);
    }

    return ids;
  },

  /**
   * Delete a single document (no recursion)
   */
  async deleteSingle(projectKey: string, docId: string): Promise<void> {
    const root = projectRoot(projectKey);
    const cached = indexManager.get(projectKey, docId);
    if (!cached) {
      return; // Already deleted or doesn't exist
    }

    const fullPath = path.join(root, cached.path);

    // Remove file
    try {
      await rm(fullPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    // Remove companion directory (contains children)
    const ext = path.extname(fullPath);
    const companionDir = fullPath.slice(0, -ext.length);
    await rm(companionDir, { recursive: true, force: true });

    // Remove from index file
    const parentDir = path.dirname(fullPath);
    await indexManager.removeFromIndexFile(parentDir, docId);

    // Remove from in-memory index
    indexManager.remove(projectKey, docId);

    // If parent directory is now empty (except for .index), remove it
    // This converts the parent document from "dir" back to "file"
    await this.cleanupEmptyParentDir(parentDir, root);
  },

  /**
   * Remove empty parent directory to convert parent doc from "dir" to "file"
   */
  async cleanupEmptyParentDir(dir: string, root: string): Promise<void> {
    // Don't remove the root docs directory
    const docsDir = path.join(root, "docs");
    if (dir === docsDir || !dir.startsWith(docsDir)) {
      return;
    }

    try {
      const entries = await readdir(dir);
      // Directory is "empty" if it only contains .index file or is truly empty
      const nonIndexEntries = entries.filter((e) => e !== ".index");
      if (nonIndexEntries.length === 0) {
        // Remove the directory (including .index if present)
        await rm(dir, { recursive: true, force: true });
      }
    } catch {
      // Directory doesn't exist or can't be read, ignore
    }
  },

  /**
   * Move a document to a new parent
   */
  async move(
    projectKey: string,
    docId: string,
    targetParentId: string,
    beforeDocId?: string,
    afterDocId?: string,
  ): Promise<void> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    const cached = indexManager.get(projectKey, docId);
    if (!cached) {
      throw new DocumentNotFoundError(docId);
    }

    const oldPath = path.join(root, cached.path);
    const oldDir = path.dirname(oldPath);

    // Determine target directory
    let targetDir: string;
    if (!targetParentId || targetParentId === "root") {
      targetDir = path.join(root, "docs");
    } else {
      const parentCache = indexManager.get(projectKey, targetParentId);
      if (!parentCache) {
        throw new Error("Target parent not found");
      }
      const parentPath = path.join(root, parentCache.path);
      const ext = path.extname(parentPath);
      targetDir = parentPath.slice(0, -ext.length);
    }

    let newPath = oldPath;
    if (oldDir !== targetDir) {
      await mkdir(targetDir, { recursive: true });

      const filename = path.basename(oldPath);
      const slug = path.basename(filename, ".json");
      const newSlug = await ensureUniqueSlug(targetDir, slug);
      const newFilename = `${newSlug}.json`;

      newPath = path.join(targetDir, newFilename);
      await renameFileAndDir(oldPath, newPath);

      // Update document metadata
      const content = await readFile(newPath, "utf-8");
      const doc = JSON.parse(content) as Document;
      const relPath = path.relative(root, newPath);

      doc.meta.parent_id = targetParentId;
      doc.meta.path = relPath;
      doc.meta.updated_at = new Date().toISOString();

      await writeFile(newPath, JSON.stringify(doc, null, 2), "utf-8");

      // Update in-memory index
      indexManager.update(projectKey, docId, {
        path: relPath,
        title: cached.title,
        parentId: targetParentId,
      });
    }

    // Update index files
    if (oldDir !== targetDir) {
      await indexManager.reorderIndexFile(oldDir, docId, undefined, undefined, false);
    }
    await indexManager.reorderIndexFile(targetDir, docId, beforeDocId, afterDocId, true);
  },

  /**
   * Get children of a parent document
   */
  async getChildren(projectKey: string, parentId: string): Promise<TreeItem[]> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    let targetDir: string;
    if (!parentId || parentId === "root") {
      targetDir = path.join(root, "docs");
    } else {
      const cached = indexManager.get(projectKey, parentId);
      if (!cached) {
        return [];
      }
      const parentPath = path.join(root, cached.path);
      const ext = path.extname(parentPath);
      targetDir = parentPath.slice(0, -ext.length);
    }

    const order = await indexManager.getOrderedChildren(projectKey, targetDir);

    const items: TreeItem[] = [];
    for (const docId of order) {
      const cached = indexManager.get(projectKey, docId);
      if (!cached) continue;

      const slug = path.basename(cached.path, ".json");

      // Check if has children (companion directory exists)
      let kind: "file" | "dir" = "file";
      try {
        const companionPath = path.join(targetDir, slug);
        const stats = await stat(companionPath);
        if (stats.isDirectory()) {
          kind = "dir";
        }
      } catch {
        // No companion directory
      }

      items.push({
        id: docId,
        slug,
        title: cached.title,
        kind,
      });
    }

    return items;
  },

  /**
   * Get the full document tree recursively
   */
  async getFullTree(projectKey: string): Promise<TreeItem[]> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    const buildTree = async (parentId: string): Promise<TreeItem[]> => {
      const children = await this.getChildren(projectKey, parentId);
      const result: TreeItem[] = [];

      for (const child of children) {
        const item: TreeItem = {
          id: child.id,
          slug: child.slug,
          title: child.title,
          kind: child.kind,
        };

        // If this item has children (is a directory), recursively get them
        if (child.kind === "dir") {
          const subChildren = await buildTree(child.id);
          if (subChildren.length > 0) {
            item.children = subChildren;
          }
        }

        result.push(item);
      }

      return result;
    };

    return buildTree("root");
  },

  /**
   * Get the hierarchy chain from root to document
   */
  async getHierarchy(projectKey: string, docId: string): Promise<DocumentMeta[]> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    if (!docId.trim()) {
      throw new DocumentNotFoundError(docId);
    }

    if (!indexManager.get(projectKey, docId)) {
      throw new DocumentNotFoundError(docId);
    }

    const chain: DocumentMeta[] = [];
    const visited = new Set<string>();
    let currentId = docId;

    while (currentId) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const cached = indexManager.get(projectKey, currentId);
      if (!cached) break;

      chain.push({
        id: currentId,
        title: cached.title,
        parent_id: cached.parentId,
        slug: "",
        path: cached.path,
        schema_version: "v1",
        created_at: "",
        updated_at: "",
      });

      const parentId = cached.parentId?.trim();
      if (!parentId || parentId === "root") break;
      currentId = parentId;
    }

    // Reverse to get root-to-document order
    chain.reverse();
    return chain;
  },

  /**
   * Get a specific block from a document
   */
  async getBlockById(
    projectKey: string,
    docId: string,
    blockId: string,
  ): Promise<Document> {
    const doc = await this.get(projectKey, docId);

    // Find block in content
    const block = findBlockById(doc.body.content, blockId);
    if (!block) {
      throw new BlockNotFoundError(blockId);
    }

    // Return document with only this block
    return {
      meta: doc.meta,
      body: {
        type: doc.body.type,
        content: {
          type: "doc",
          content: [block],
        },
      },
    };
  },

  /**
   * Get all document IDs for a project
   */
  async getAllDocumentIds(projectKey: string): Promise<string[]> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);
    return indexManager.getAllIds(projectKey);
  },

  /**
   * Get all documents for a project (for indexing purposes)
   */
  async getAllDocuments(projectKey: string): Promise<Document[]> {
    const ids = await this.getAllDocumentIds(projectKey);
    const documents: Document[] = [];
    
    for (const docId of ids) {
      try {
        const doc = await this.get(projectKey, docId);
        documents.push(doc);
      } catch (err) {
        // Skip documents that fail to load
        console.warn(`Failed to load document ${docId}:`, err);
      }
    }
    
    return documents;
  },

  /**
   * Suggest documents matching a query string
   * Matches against document titles and title paths
   * @param parentId - Optional: Only search children of this parent (empty string or "root" = root level)
   */
  async suggest(
    projectKey: string,
    query: string,
    limit = 10,
    parentId?: string,
  ): Promise<Array<{
    id: string;
    title: string;
    titlePath: string;
    hasChildren: boolean;
  }>> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    // If parentId is provided, only get children of that parent
    let docsToSearch: Array<[string, CachedDoc]>;
    if (parentId !== undefined) {
      const normalizedParentId = parentId === "" || parentId === "root" ? "root" : parentId;
      const children = await this.getChildren(projectKey, normalizedParentId);
      docsToSearch = children
        .map((child) => {
          const cached = indexManager.get(projectKey, child.id);
          return cached ? [child.id, cached] as [string, CachedDoc] : null;
        })
        .filter((item): item is [string, CachedDoc] => item !== null);
    } else {
      docsToSearch = Array.from(indexManager.getAll(projectKey));
    }

    const results: Array<{
      id: string;
      title: string;
      titlePath: string;
      hasChildren: boolean;
      score: number;
    }> = [];

    const queryLower = query.toLowerCase().trim();
    const queryParts = queryLower.split("/").filter(Boolean);

    for (const [docId, cached] of docsToSearch) {
      const titlePath = indexManager.buildTitlePath(projectKey, docId);
      const titlePathLower = titlePath.toLowerCase();
      const titleLower = cached.title.toLowerCase();

      let score = 0;

      // Match by title path (for hierarchical queries like "设计/用户")
      if (queryParts.length > 0) {
        const pathParts = titlePathLower.split("/");
        let matchCount = 0;
        let lastMatchIdx = -1;

        for (const qPart of queryParts) {
          for (let i = lastMatchIdx + 1; i < pathParts.length; i++) {
            if (pathParts[i].includes(qPart)) {
              matchCount++;
              lastMatchIdx = i;
              break;
            }
          }
        }

        if (matchCount === queryParts.length) {
          // All query parts matched in order
          score = 100 + matchCount * 10;
          // Bonus for exact match at end
          if (pathParts[pathParts.length - 1].startsWith(queryParts[queryParts.length - 1])) {
            score += 20;
          }
        } else if (matchCount > 0) {
          score = 50 + matchCount * 5;
        }
      }

      // Simple title matching
      if (score === 0 && queryLower) {
        if (titleLower.startsWith(queryLower)) {
          score = 80;
        } else if (titleLower.includes(queryLower)) {
          score = 60;
        } else if (titlePathLower.includes(queryLower)) {
          score = 40;
        }
      }

      // If no query, include all documents with lower score
      if (!queryLower) {
        score = 10;
      }

      if (score > 0) {
        // Check if has children
        let hasChildren = false;
        try {
          const children = await this.getChildren(projectKey, docId);
          hasChildren = children.length > 0;
        } catch {
          // Ignore errors
        }

        results.push({
          id: docId,
          title: cached.title,
          titlePath,
          hasChildren,
          score,
        });
      }
    }

    // Sort by score descending, then by title path length (shorter = more relevant)
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.titlePath.length - b.titlePath.length;
    });

    return results.slice(0, limit).map(({ id, title, titlePath, hasChildren }) => ({
      id,
      title,
      titlePath,
      hasChildren,
    }));
  },
};

/**
 * Recursively find a block by ID in Tiptap content
 */
function findBlockById(content: unknown, blockId: string): unknown | null {
  if (!content || typeof content !== "object") return null;

  if (Array.isArray(content)) {
    for (const item of content) {
      const found = findBlockById(item, blockId);
      if (found) return found;
    }
    return null;
  }

  const node = content as Record<string, unknown>;

  // Check if this node has the target block ID
  const attrs = node.attrs as Record<string, unknown> | undefined;
  if (attrs?.id === blockId) {
    return node;
  }

  // Search children
  if (node.content) {
    return findBlockById(node.content, blockId);
  }

  return null;
}
