import { mkdir, readFile, writeFile, rm, rename, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

import { indexManager } from "./index-manager.js";
import type { Document, DocumentMeta, TreeItem } from "./types.js";

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
   * Delete a document
   */
  async delete(projectKey: string, docId: string): Promise<void> {
    const root = projectRoot(projectKey);
    await indexManager.ensure(projectKey, root);

    const cached = indexManager.get(projectKey, docId);
    if (!cached) {
      throw new DocumentNotFoundError(docId);
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

    // Remove companion directory
    const ext = path.extname(fullPath);
    const companionDir = fullPath.slice(0, -ext.length);
    await rm(companionDir, { recursive: true, force: true });

    // Remove from index file
    const parentDir = path.dirname(fullPath);
    await indexManager.removeFromIndexFile(parentDir, docId);

    // Remove from in-memory index
    indexManager.remove(projectKey, docId);
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
