import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import type { JSONContent } from "@tiptap/core";

import { convertDocument } from "./services/convert.js";
import { fetchUrl } from "./services/fetch-url.js";
import { importGit } from "./services/import-git.js";
import { importFileAsDocument } from "./services/smart-import.js";
import {
  readAsset as readSystemDocAsset,
  readMarkdown as readSystemDocMarkdown,
  scanDocsTree,
  SystemDocsError,
} from "./services/system-docs.js";
import { ensureBlockIds } from "./utils/block-id.js";
import { traceManager } from "./observability/index.js";
import {
  documentStore,
  DocumentNotFoundError,
  BlockNotFoundError,
} from "./storage/document-store.js";
import type { Document, CreateDocumentRequest, MoveDocumentRequest, SearchQuery } from "./storage/types.js";
import { knowledgeSearch } from "./knowledge/search.js";
import { rebuildTaskManager } from "./knowledge/rebuild-task.js";
import { notifyDocumentMoved } from "./knowledge/tree-sync.js";
import { assetStore } from "./storage/asset-store.js";
import { getUserId } from "./middleware/auth.js";
import { projectScopeMiddleware } from "./middleware/project-scope.js";
import {
  llmGateway,
  configStore,
  providerRegistry,
  type ChatOptions,
  type CompletionOptions,
  type EmbeddingOptions,
  type ProviderConfigInput,
  type LLMProviderId,
  type ConfigType,
} from "./llm/index.js";
import {
  createRun,
  getRun,
  streamRun,
  clearSession,
  cancelRun,
  confirmTool,
  rejectTool,
  selectIntent,
  providePreflightInput,
  provideRequiredInput,
} from "./services/chat.js";
import { draftService } from "./services/draft.js";
import {
  createTask as createOptimizeTask,
  getTask as getOptimizeTask,
  streamTask as streamOptimizeTask,
  optimizeFormatSync,
  type OptimizeMode,
} from "./services/optimize.js";
import { documentFavoriteStore } from "./services/document-favorite-store.js";
import { documentRecentEditStore } from "./services/document-recent-edit-store.js";
import { skillConfigStore } from "./llm/skills/skill-config-store.js";
import { agentSkillCatalog, projectSkillConfigStore } from "./llm/agent/index.js";
import { zodObjectHasRequiredKey } from "./llm/zod.js";
import { pluginManagerV2 } from "./plugins-v2/index.js";

const upload = multer({ storage: multer.memoryStorage() });
const pluginManager = pluginManagerV2;

/**
 * Determine asset kind from MIME type
 */
/**
 * Fix filename encoding (handle Latin-1 interpreted as UTF-8)
 */
function fixFilename(filename: string): string {
  try {
    // Try to detect if the filename was incorrectly decoded as Latin-1
    // If we can re-encode as Latin-1 and decode as UTF-8, do it
    const latin1 = Buffer.from(filename, 'latin1');
    const utf8 = latin1.toString('utf8');
    // Check if the result looks valid (contains original characters or common UTF-8 patterns)
    if (utf8 !== filename && !utf8.includes('\ufffd')) {
      return utf8;
    }
  } catch (e) {
    // Ignore decoding errors
  }
  return filename;
}

function parseBool(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }
  return defaultValue;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
      }
    } catch {
      // Ignore
    }
    return trimmed.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function sanitizeUrlForTrace(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    return u.toString();
  } catch {
    return raw.replace(/\/\/[^@]*@/, "//");
  }
}

/**
 * Determine asset kind from MIME type
 */
function getAssetKind(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("word") || mime.includes("document")) return "document";
  if (mime.includes("sheet") || mime.includes("excel")) return "spreadsheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation";
  if (mime.startsWith("text/")) return "text";
  return "file";
}

/**
 * Extract text content from HTML (simple extraction)
 */
function extractTextFromHtml(html: string): string {
  // Remove scripts and styles
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/**
 * Standard API response helper
 */
function success<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ code: "OK", message: "success", data });
}

/**
 * Standard error response helper
 */
function error(res: Response, code: string, message: string, status = 400): void {
  res.status(status).json({ code, message });
}

type DocumentHookEvent =
  | "document.create"
  | "document.update"
  | "document.delete"
  | "document.move"
  | "document.import"
  | "document.optimize";

async function applyDocumentBeforeHooks(
  req: Request,
  res: Response,
  event: DocumentHookEvent,
  payload: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; requestId: string } | null> {
  try {
    const userId = getUserId(req);
    const projectKey = String(req.params.projectKey || "").trim();
    const requestId = `plugin-hook-${uuidv4()}`;

    const result = await pluginManager.runBeforeHooks({
      userId,
      projectKey,
      event,
      payload,
      requestId,
    });

    if (!result.allowed) {
      const rejection = result.rejection || {
        code: "PLUGIN_HOOK_REJECTED",
        message: "Operation rejected by plugin hook",
        status: 400,
      };
      error(res, rejection.code, rejection.message, rejection.status);
      return null;
    }

    return {
      payload: result.payload,
      requestId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Plugin before-hook execution failed";
    error(res, "PLUGIN_HOOK_FAILED", message, 500);
    return null;
  }
}

function dispatchDocumentAfterHooks(
  req: Request,
  event: DocumentHookEvent,
  payload: Record<string, unknown>,
  requestId: string,
): void {
  const userId = getUserId(req);
  const projectKey = String(req.params.projectKey || "").trim();
  pluginManager.dispatchAfterHooks({
    userId,
    projectKey,
    event,
    payload,
    requestId,
  });
}

/**
 * Recursively update block attributes in document content
 */
function updateBlockAttrsInContent(
  content: JSONContent,
  blockId: string,
  newAttrs: Record<string, unknown>,
): boolean {
  // Check if this node matches
  if (content.attrs?.id === blockId) {
    content.attrs = { ...content.attrs, ...newAttrs };
    return true;
  }

  // Recursively check children
  if (content.content && Array.isArray(content.content)) {
    for (const child of content.content) {
      if (updateBlockAttrsInContent(child, blockId, newAttrs)) {
        return true;
      }
    }
  }

  return false;
}

export const buildRouter = () => {
  const router = Router();

  // ============================================
  // System Docs APIs (read-only, filesystem-based)
  // ============================================

  /**
   * Get system docs tree
   * GET /system-docs/tree
   */
  router.get("/system-docs/tree", async (req: Request, res: Response) => {
    try {
      const language = String(req.query.lang ?? "");
      const tree = await scanDocsTree(language);
      success(res, tree);
    } catch (err) {
      if (err instanceof SystemDocsError) {
        error(res, err.code, err.message, err.status);
        return;
      }
      const message = err instanceof Error ? err.message : "Get system docs tree failed";
      error(res, "SYSTEM_DOCS_FAILED", message, 500);
    }
  });

  /**
   * Get markdown content from system docs
   * GET /system-docs/content?path=xxx
   */
  router.get("/system-docs/content", async (req: Request, res: Response) => {
    try {
      const relativePath = String(req.query.path ?? "");
      const language = String(req.query.lang ?? "");
      const data = await readSystemDocMarkdown(relativePath, language);
      success(res, data);
    } catch (err) {
      if (err instanceof SystemDocsError) {
        error(res, err.code, err.message, err.status);
        return;
      }
      const message = err instanceof Error ? err.message : "Read system doc failed";
      error(res, "SYSTEM_DOCS_FAILED", message, 500);
    }
  });

  /**
   * Get static asset from system docs
   * GET /system-docs/asset?path=xxx
   */
  router.get("/system-docs/asset", async (req: Request, res: Response) => {
    try {
      const relativePath = String(req.query.path ?? "");
      const data = await readSystemDocAsset(relativePath);

      res.setHeader("Content-Type", data.mime);
      const asciiFilename = path.basename(data.path).replace(/[^\x20-\x7E]/g, "_");
      const encodedFilename = encodeURIComponent(path.basename(data.path));
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
      );
      res.send(data.buffer);
    } catch (err) {
      if (err instanceof SystemDocsError) {
        error(res, err.code, err.message, err.status);
        return;
      }
      const message = err instanceof Error ? err.message : "Read system doc asset failed";
      error(res, "SYSTEM_DOCS_FAILED", message, 500);
    }
  });

  router.use("/projects/:ownerType/:ownerKey/:projectKey", projectScopeMiddleware);

  // ============================================
  // Document CRUD APIs
  // ============================================

  /**
   * List documents under a parent
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents?parent_id=xxx
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/documents", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const parentId = String(req.query.parent_id ?? "");
      const items = await documentStore.getChildren(userId, projectKey, parentId);
      success(res, items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "List failed";
      error(res, "LIST_FAILED", message, 500);
    }
  });

  /**
   * Get the full document tree (all documents with nested children)
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/tree
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/documents/tree", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const tree = await documentStore.getFullTree(userId, projectKey);
      success(res, tree);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Get tree failed";
      error(res, "TREE_FAILED", message, 500);
    }
  });

  /**
   * Suggest documents matching a query (for @ mention autocomplete)
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/suggest?q=xxx&limit=10&parentId=xxx
   * @param parentId - Optional: Only search children of this parent ("root" or "" for root level)
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/documents/suggest", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const query = String(req.query.q || "");
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 50);
      // parentId: undefined = search all, "root" or "" = root level only, other = children of that doc
      const parentId = req.query.parentId !== undefined ? String(req.query.parentId) : undefined;

      const suggestions = await documentStore.suggest(userId, projectKey, query, limit, parentId);
      success(res, suggestions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Suggest failed";
      error(res, "SUGGEST_FAILED", message, 500);
    }
  });

  /**
   * List favorite documents for current user + project
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/favorites
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/documents/favorites", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const favorites = await documentFavoriteStore.list(userId, projectKey);
      success(res, favorites);
    } catch (err) {
      const message = err instanceof Error ? err.message : "List favorites failed";
      error(res, "LIST_FAVORITES_FAILED", message, 500);
    }
  });

  /**
   * List recently edited documents for current user + project
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/recent-edits
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/documents/recent-edits", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const recentEdits = await documentRecentEditStore.list(userId, projectKey);
      success(res, recentEdits);
    } catch (err) {
      const message = err instanceof Error ? err.message : "List recent edits failed";
      error(res, "LIST_RECENT_EDITS_FAILED", message, 500);
    }
  });

  /**
   * Favorite a document (idempotent, repeats move to top)
   * PUT /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/favorite
   */
  router.put(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/favorite",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);

        await documentFavoriteStore.add(userId, projectKey, docId);
        const favorites = await documentFavoriteStore.list(userId, projectKey);
        success(res, favorites);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          error(res, "NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Favorite failed";
        error(res, "FAVORITE_FAILED", message, 500);
      }
    },
  );

  /**
   * Remove document from favorites (idempotent)
   * DELETE /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/favorite
   */
  router.delete(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/favorite",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);

        await documentFavoriteStore.remove(userId, projectKey, docId);
        const favorites = await documentFavoriteStore.list(userId, projectKey);
        success(res, favorites);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unfavorite failed";
        error(res, "UNFAVORITE_FAILED", message, 500);
      }
    },
  );

  /**
   * Get a document by ID
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/:docId
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      const userId = getUserId(req);
      const doc = await documentStore.get(userId, projectKey, docId);
      success(res, { meta: doc.meta, body: doc.body });
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        error(res, "NOT_FOUND", err.message, 404);
        return;
      }
      const message = err instanceof Error ? err.message : "Get failed";
      error(res, "GET_FAILED", message, 500);
    }
  });

  /**
   * Get document hierarchy (ancestor chain)
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/hierarchy
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/hierarchy",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);
        const chain = await documentStore.getHierarchy(userId, projectKey, docId);
        const items = chain.map((m) => ({
          id: m.id,
          title: m.title,
          parent_id: m.parent_id,
        }));
        success(res, items);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          error(res, "NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Get hierarchy failed";
        error(res, "GET_HIERARCHY_FAILED", message, 500);
      }
    },
  );

  /**
   * Get a specific block from a document
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/blocks/:blockId
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/blocks/:blockId",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId, blockId } = req.params;
        const userId = getUserId(req);
        const doc = await documentStore.getBlockById(userId, projectKey, docId, blockId);
        success(res, { meta: doc.meta, body: doc.body });
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          error(res, "NOT_FOUND", err.message, 404);
          return;
        }
        if (err instanceof BlockNotFoundError) {
          error(res, "BLOCK_NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Get block failed";
        error(res, "GET_BLOCK_FAILED", message, 500);
      }
    },
  );

  /**
   * Create a new document
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/documents", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const body = req.body as CreateDocumentRequest;

      const before = await applyDocumentBeforeHooks(req, res, "document.create", {
        body,
      });
      if (!before) {
        return;
      }
      const nextBody = (before.payload.body && typeof before.payload.body === "object"
        ? before.payload.body
        : body) as CreateDocumentRequest;

      if (!nextBody.meta?.title) {
        error(res, "MISSING_TITLE", "title is required");
        return;
      }

      const doc: Document = {
        meta: {
          id: nextBody.meta.id || uuidv4(),
          schema_version: nextBody.meta.schema_version || "v1",
          title: nextBody.meta.title,
          slug: nextBody.meta.slug || "",
          path: "",
          parent_id: nextBody.meta.parent_id || "root",
          created_at: "",
          updated_at: "",
          extra: nextBody.meta.extra,
        },
        body: {
          ...nextBody.body,
          content: nextBody.body?.content ? ensureBlockIds(nextBody.body.content as JSONContent) : nextBody.body?.content,
        },
      };

      const saved = await documentStore.save(userId, projectKey, doc);

      // Index the document asynchronously
      knowledgeSearch.indexDocument(userId, projectKey, saved).catch((err) => {
        console.error("Index error:", err);
      });

      dispatchDocumentAfterHooks(req, "document.create", {
        request: before.payload,
        saved,
      }, before.requestId);

      success(res, { meta: saved.meta, body: saved.body }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Create failed";
      error(res, "CREATE_FAILED", message, 500);
    }
  });

  /**
   * Update an existing document
   * PUT /projects/:ownerType/:ownerKey/:projectKey/documents/:docId
   */
  router.put("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      const userId = getUserId(req);
      const body = req.body as CreateDocumentRequest;

      const before = await applyDocumentBeforeHooks(req, res, "document.update", {
        docId,
        body,
      });
      if (!before) {
        return;
      }
      const nextBody = (before.payload.body && typeof before.payload.body === "object"
        ? before.payload.body
        : body) as CreateDocumentRequest;

      // Get existing document
      const existing = await documentStore.get(userId, projectKey, docId);

      // Merge updates
      const updatedBody = nextBody.body || existing.body;
      const doc: Document = {
        meta: {
          ...existing.meta,
          ...nextBody.meta,
          id: docId, // Ensure ID doesn't change
        },
        body: {
          ...updatedBody,
          content: updatedBody?.content ? ensureBlockIds(updatedBody.content as JSONContent) : updatedBody?.content,
        },
      };

      const saved = await documentStore.save(userId, projectKey, doc);

      // Re-index the document asynchronously
      knowledgeSearch.indexDocument(userId, projectKey, saved).catch((err) => {
        console.error("Index error:", err);
      });

      dispatchDocumentAfterHooks(req, "document.update", {
        request: before.payload,
        saved,
      }, before.requestId);

      success(res, { meta: saved.meta, body: saved.body });
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        error(res, "NOT_FOUND", err.message, 404);
        return;
      }
      const message = err instanceof Error ? err.message : "Update failed";
      error(res, "UPDATE_FAILED", message, 500);
    }
  });

  /**
   * Delete a document (optionally recursive)
   * DELETE /projects/:ownerType/:ownerKey/:projectKey/documents/:docId?recursive=true
   */
  router.delete("/projects/:ownerType/:ownerKey/:projectKey/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      const userId = getUserId(req);
      const recursive = req.query.recursive === "true";

      const before = await applyDocumentBeforeHooks(req, res, "document.delete", {
        docId,
        recursive,
      });
      if (!before) {
        return;
      }
      const nextDocId = typeof before.payload.docId === "string" && before.payload.docId.trim()
        ? before.payload.docId.trim()
        : docId;
      const nextRecursive = before.payload.recursive === true || recursive;
      
      const deletedIds = await documentStore.delete(userId, projectKey, nextDocId, nextRecursive);

      await documentFavoriteStore.removeMany(userId, projectKey, deletedIds);

      documentRecentEditStore.removeMany(userId, projectKey, deletedIds).catch((cleanupErr) => {
        console.error("Cleanup recent edits error:", cleanupErr);
      });

      // Remove all deleted documents from index asynchronously
      for (const deletedId of deletedIds) {
        knowledgeSearch.removeDocument(userId, projectKey, deletedId).catch((err) => {
          console.error("Remove index error:", err);
        });
      }

      dispatchDocumentAfterHooks(req, "document.delete", {
        request: before.payload,
        deletedIds,
      }, before.requestId);

      success(res, { deleted_ids: deletedIds, count: deletedIds.length });
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        error(res, "NOT_FOUND", err.message, 404);
        return;
      }
      const message = err instanceof Error ? err.message : "Delete failed";
      error(res, "DELETE_FAILED", message, 500);
    }
  });

  /**
   * Update block attributes (for taskItem checked state, etc.)
   * PATCH /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/blocks/:blockId
   */
  router.patch(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/blocks/:blockId",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId, blockId } = req.params;
        const userId = getUserId(req);
        const { attrs } = req.body as { attrs: Record<string, unknown> };

        if (!attrs || typeof attrs !== "object") {
          error(res, "INVALID_REQUEST", "attrs is required and must be an object");
          return;
        }

        // Get existing document
        const doc = await documentStore.get(userId, projectKey, docId);

        // Update block attrs in content
        // Document structure: body.content = { meta: {...}, content: { type: "doc", content: [...] } }
        // or body.content = { type: "doc", content: [...] }
        const bodyContent = doc.body?.content as JSONContent | undefined;
        if (!bodyContent) {
          error(res, "INVALID_DOCUMENT", "Document has no content");
          return;
        }

        // Extract the actual tiptap document content
        let docContent: JSONContent;
        if (bodyContent.type === "doc") {
          // Direct tiptap format
          docContent = bodyContent;
        } else if (bodyContent.content && typeof bodyContent.content === "object" && (bodyContent.content as JSONContent).type === "doc") {
          // Nested format: { meta: {...}, content: { type: "doc", ... } }
          docContent = bodyContent.content as JSONContent;
        } else {
          error(res, "INVALID_DOCUMENT", "Invalid document content structure");
          return;
        }

        const updated = updateBlockAttrsInContent(docContent, blockId, attrs);
        if (!updated) {
          error(res, "BLOCK_NOT_FOUND", `Block ${blockId} not found in document`, 404);
          return;
        }

        // Save updated document
        const savedDoc: Document = {
          meta: doc.meta,
          body: doc.body,
        };
        await documentStore.save(userId, projectKey, savedDoc);

        // Re-index asynchronously
        knowledgeSearch.indexDocument(userId, projectKey, savedDoc).catch((err) => {
          console.error("Index error:", err);
        });

        success(res, { blockId, attrs });
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          error(res, "NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Update block failed";
        error(res, "UPDATE_BLOCK_FAILED", message, 500);
      }
    },
  );

  /**
   * Move a document to a new parent
   * PATCH /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/move
   */
  router.patch(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/move",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);
        const body = req.body as MoveDocumentRequest;

        const beforeHook = await applyDocumentBeforeHooks(req, res, "document.move", {
          docId,
          body,
        });
        if (!beforeHook) {
          return;
        }
        const nextDocId = typeof beforeHook.payload.docId === "string" && beforeHook.payload.docId.trim()
          ? beforeHook.payload.docId.trim()
          : docId;
        const nextBody = (beforeHook.payload.body && typeof beforeHook.payload.body === "object"
          ? beforeHook.payload.body
          : body) as MoveDocumentRequest;

        // Capture old/new parent ids so we can sync knowledge_index paths after move.
        const normalizeParentId = (id: string | null | undefined): string | null => {
          const value = (id ?? "").trim();
          if (!value || value === "root") return null;
          return value;
        };
        const before = await documentStore.get(userId, projectKey, nextDocId);
        const oldParentId = normalizeParentId(before.meta.parent_id);
        const newParentId = normalizeParentId(nextBody.target_parent_id);

        await documentStore.move(
          userId,
          projectKey,
          nextDocId,
          nextBody.target_parent_id,
          nextBody.before_doc_id,
          nextBody.after_doc_id,
        );

        if (oldParentId !== newParentId) {
          notifyDocumentMoved(userId, projectKey, nextDocId, oldParentId, newParentId).catch((err) => {
            console.warn("[TreeSync] notifyDocumentMoved failed:", err);
          });
        }

        dispatchDocumentAfterHooks(req, "document.move", {
          request: beforeHook.payload,
          moved: true,
          docId: nextDocId,
          oldParentId,
          newParentId,
        }, beforeHook.requestId);

        success(res, null);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          error(res, "NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Move failed";
        error(res, "MOVE_FAILED", message, 500);
      }
    },
  );

  // ============================================
  // Document Optimization APIs
  // ============================================

  /**
   * Start document optimization task
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/optimize
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/optimize",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);
        const body = req.body as { mode?: OptimizeMode; preserveStructure?: boolean; language?: string };

        const before = await applyDocumentBeforeHooks(req, res, "document.optimize", {
          docId,
          body,
        });
        if (!before) {
          return;
        }
        const nextBody = (before.payload.body && typeof before.payload.body === "object"
          ? before.payload.body
          : body) as { mode?: OptimizeMode; preserveStructure?: boolean; language?: string };

        const mode: OptimizeMode = nextBody.mode || "full";
        if (!["format", "content", "full"].includes(mode)) {
          error(res, "INVALID_MODE", "mode must be 'format', 'content', or 'full'");
          return;
        }

        const taskId = await createOptimizeTask(userId, projectKey, docId, {
          mode,
          preserveStructure: nextBody.preserveStructure,
          language: nextBody.language,
        });

        dispatchDocumentAfterHooks(req, "document.optimize", {
          request: before.payload,
          taskId,
          docId,
        }, before.requestId);

        success(res, { taskId }, 201);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          error(res, "NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Failed to create optimization task";
        error(res, "OPTIMIZE_TASK_FAILED", message, 500);
      }
    },
  );

  /**
   * Stream optimization results
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/optimize/:taskId/stream
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/optimize/:taskId/stream",
    async (req: Request, res: Response) => {
      const { taskId } = req.params;

      const task = getOptimizeTask(taskId);
      if (!task) {
        error(res, "NOT_FOUND", "Task not found", 404);
        return;
      }

      // Set up SSE
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      try {
        for await (const chunk of streamOptimizeTask(taskId)) {
          if (chunk.type === "delta") {
            res.write(`event: optimize.delta\ndata: ${JSON.stringify({ content: chunk.content })}\n\n`);
          } else if (chunk.type === "done") {
            res.write(
              `event: optimize.done\ndata: ${JSON.stringify({
                originalMarkdown: chunk.originalMarkdown,
                optimizedMarkdown: chunk.optimizedMarkdown,
                optimizedContent: chunk.optimizedContent,
              })}\n\n`,
            );
          } else if (chunk.type === "error") {
            res.write(`event: optimize.error\ndata: ${JSON.stringify({ error: chunk.error })}\n\n`);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Streaming failed";
        res.write(`event: optimize.error\ndata: ${JSON.stringify({ error: message })}\n\n`);
      } finally {
        res.end();
      }
    },
  );

  /**
   * Get optimization task status
   * GET /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/optimize/:taskId
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/optimize/:taskId",
    async (req: Request, res: Response) => {
      const { taskId } = req.params;

      const task = getOptimizeTask(taskId);
      if (!task) {
        error(res, "NOT_FOUND", "Task not found", 404);
        return;
      }

      success(res, {
        id: task.id,
        status: task.status,
        originalMarkdown: task.originalMarkdown,
        optimizedMarkdown: task.optimizedMarkdown,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });
    },
  );

  // ============================================
  // Import APIs (existing + enhanced)
  // ============================================

  /**
   * Convert document format
   * POST /projects/:ownerType/:ownerKey/:projectKey/convert
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/convert",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const userId = getUserId(req);
        const from = String(req.query.from ?? "");
        const to = String(req.query.to ?? "");
        if (!req.file) {
          error(res, "INVALID_REQUEST", "file is required");
          return;
        }
        const result = await convertDocument(userId, projectKey, req.file, from, to);
        success(res, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Convert failed";
        error(res, "CONVERT_FAILED", message);
      }
    },
  );

  /**
   * Fetch URL content
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents/fetch-url
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/documents/fetch-url", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const url = String(req.body?.url ?? "");
      const result = await fetchUrl(userId, projectKey, url);
      success(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fetch failed";
      error(res, "FETCH_FAILED", message);
    }
  });

  /**
   * Import from Git repository
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents/import-git
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/import-git",
    async (req: Request, res: Response) => {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const traceId = `import-git-${uuidv4()}`;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const before = await applyDocumentBeforeHooks(req, res, "document.import", {
        source: "git",
        body,
      });
      if (!before) {
        return;
      }
      const nextBody = before.payload.body && typeof before.payload.body === "object"
        ? before.payload.body as Record<string, unknown>
        : body;

      const traceContext = traceManager.startTrace(traceId, {
        name: "import-git",
        userId,
        projectKey,
        tags: ["import", "import-git"],
        metadata: {
          repo_url: sanitizeUrlForTrace(nextBody.repo_url),
          branch: nextBody.branch,
          subdir: nextBody.subdir,
          parent_id: nextBody.parent_id,
          smart_import: nextBody.smart_import,
          smart_import_types: nextBody.smart_import_types,
          file_types: nextBody.file_types,
          enable_format_optimize: nextBody.enable_format_optimize,
        },
      });

      try {
        const result = await importGit(userId, projectKey, nextBody as any, traceContext);
        traceManager.updateTrace(traceContext, { output: result });
        dispatchDocumentAfterHooks(req, "document.import", {
          request: before.payload,
          result,
          source: "git",
        }, before.requestId);
        success(res, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed";
        traceManager.updateTrace(traceContext, { output: { error: message } });
        error(res, "IMPORT_FAILED", message);
      } finally {
        traceManager.endTrace(traceId);
      }
    },
  );

  /**
   * Upload file as document (creates a document directly)
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents/upload
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const userId = getUserId(req);
        const file = req.file;
        if (!file) {
          error(res, "INVALID_REQUEST", "file is required");
          return;
        }

        const before = await applyDocumentBeforeHooks(req, res, "document.import", {
          source: "upload",
          filename: file.originalname,
          mime: file.mimetype,
          size: file.size,
          body: req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {},
        });
        if (!before) {
          return;
        }

        const parentId = String(req.query.parent_id ?? "root");
        const filename = fixFilename(file.originalname);
        const sourceType = String(req.body?.source_type ?? "").trim().toLowerCase();
        const from = sourceType || filename.split(".").pop() || "";
        
        // Convert the file to markdown
        const converted = await convertDocument(userId, projectKey, file, from, "markdown");
        
        // Create a document with the converted content
        const title = filename.replace(/\.[^/.]+$/, "") || "Untitled";
        const doc: Document = {
          meta: {
            id: uuidv4(),
            schema_version: "v1",
            title,
            slug: "",
            path: "",
            parent_id: parentId,
            created_at: "",
            updated_at: "",
          },
          body: {
            type: "markdown",
            content: converted.content,
          },
        };
        
        const saved = await documentStore.save(userId, projectKey, doc);
        
        // Index the document asynchronously
        knowledgeSearch.indexDocument(userId, projectKey, saved).catch((err) => {
          console.error("Index error:", err);
        });

        dispatchDocumentAfterHooks(req, "document.import", {
          request: before.payload,
          source: "upload",
          saved,
        }, before.requestId);
        
        success(res, { meta: saved.meta, body: saved.body }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        error(res, "UPLOAD_FAILED", message);
      }
    },
  );

  /**
   * Import a file and create a document (smart import if enabled)
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents/import-file
   *
   * FormData fields:
   * - file: required
   * - parent_id: optional (default: root)
   * - title: optional (default: filename without extension)
   * - smart_import: optional boolean
   * - smart_import_types: optional JSON array or comma-separated string
   * - enable_format_optimize: optional boolean
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/import-file",
    upload.single("file"),
    async (req: Request, res: Response) => {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const file = req.file;
      if (!file) {
        error(res, "INVALID_REQUEST", "file is required");
        return;
      }

      const before = await applyDocumentBeforeHooks(req, res, "document.import", {
        source: "import-file",
        filename: file.originalname,
        mime: file.mimetype,
        size: file.size,
        body: req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {},
      });
      if (!before) {
        return;
      }

      const parentId = String(req.body?.parent_id ?? "root");
      const title = String(req.body?.title ?? "").trim() || undefined;
      const smartImport = parseBool(req.body?.smart_import, false);
      const smartImportTypes = parseStringArray(req.body?.smart_import_types).filter((t) =>
        t === "markdown" || t === "word" || t === "pdf" || t === "image",
      ) as Array<"markdown" | "word" | "pdf" | "image">;
      const enableFormatOptimize = parseBool(req.body?.enable_format_optimize, false);

      const filename = fixFilename(file.originalname);
      const traceId = `import-file-${uuidv4()}`;
      const traceContext = traceManager.startTrace(traceId, {
        name: "import-file",
        userId,
        projectKey,
        tags: ["import", "import-file"],
        metadata: {
          filename,
          mime: file.mimetype,
          size: file.size,
          parentId,
          title,
          smartImport,
          smartImportTypes,
          enableFormatOptimize,
        },
      });

      try {
        const result = await importFileAsDocument(userId, projectKey, {
          parentId,
          title,
          file: {
            buffer: file.buffer,
            originalname: filename,
            mimetype: file.mimetype,
            size: file.size,
          },
          smartImport,
          smartImportTypes,
          enableFormatOptimize,
          traceContext,
        });

        traceManager.updateTrace(traceContext, {
          output: { docId: result.docId, title: result.title, mode: result.mode },
        });
        dispatchDocumentAfterHooks(req, "document.import", {
          request: before.payload,
          source: "import-file",
          result,
        }, before.requestId);
        success(res, { id: result.docId, title: result.title, mode: result.mode }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed";
        traceManager.updateTrace(traceContext, { output: { error: message } });
        error(res, "IMPORT_FAILED", message, 500);
      } finally {
        traceManager.endTrace(traceId);
      }
    },
  );

  /**
   * Import file as document (returns converted content without saving)
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents/import
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/import",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const file = req.file;
        if (!file) {
          error(res, "INVALID_REQUEST", "file is required");
          return;
        }
        const userId = getUserId(req);
        const filename = fixFilename(file.originalname);
        const sourceType = String(req.body?.source_type ?? "").trim().toLowerCase();
        const from = sourceType || filename.split(".").pop() || "";
        const converted = await convertDocument(userId, projectKey, file, from, "markdown");
        success(res, converted);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed";
        error(res, "IMPORT_FAILED", message);
      }
    },
  );

  /**
   * Optimize markdown format using LLM
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents/optimize-format
   * Body: { markdown: string }
   * 
   * This is a fail-safe endpoint: if optimization fails, returns original markdown.
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/optimize-format",
    async (req: Request, res: Response) => {
      const { projectKey } = req.params;
      const userId = getUserId(req);

      const markdown = String(req.body?.markdown ?? "");
      if (!markdown.trim()) {
        error(res, "INVALID_REQUEST", "markdown is required");
        return;
      }

      const traceId = `optimize-format-${uuidv4()}`;
      const traceContext = traceManager.startTrace(traceId, {
        name: "optimize-format",
        userId,
        projectKey,
        tags: ["llm", "optimize-format"],
        metadata: {
          markdownChars: markdown.length,
        },
      });

      try {
        const optimized = await optimizeFormatSync(markdown, {
          traceContext,
          traceMetadata: {
            source: "api",
            endpoint: "documents/optimize-format",
          },
        });

        traceManager.updateTrace(traceContext, {
          output: {
            optimized: optimized !== markdown,
            markdownChars: markdown.length,
            optimizedChars: optimized.length,
          },
        });

        success(res, {
          markdown: optimized,
          optimized: optimized !== markdown,
        });
      } catch (err) {
        // This should not happen as optimizeFormatSync is fail-safe
        const message = err instanceof Error ? err.message : "Optimization failed";
        traceManager.updateTrace(traceContext, { output: { error: message } });
        error(res, "OPTIMIZE_FAILED", message);
      } finally {
        traceManager.endTrace(traceId);
      }
    },
  );

  // ============================================
  // Asset APIs
  // ============================================

  /**
   * Upload an asset (image, file, etc.)
   * POST /projects/:ownerType/:ownerKey/:projectKey/assets/import
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/assets/import",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const userId = getUserId(req);
        const file = req.file;
        if (!file) {
          error(res, "INVALID_REQUEST", "file is required");
          return;
        }
        
        const filename = fixFilename(file.originalname);
        const meta = await assetStore.save(
          userId,
          projectKey,
          filename,
          file.mimetype,
          file.buffer
        );
        
        success(res, {
          asset_id: meta.id,
          filename: meta.filename,
          mime: meta.mime,
          size: meta.size,
        }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        error(res, "UPLOAD_FAILED", message);
      }
    },
  );

  /**
   * Get asset content
   * GET /projects/:ownerType/:ownerKey/:projectKey/assets/:assetId/content
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/assets/:assetId/content",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, assetId } = req.params;
        const userId = getUserId(req);
        const result = await assetStore.getContent(userId, projectKey, assetId);
        
        if (!result) {
          error(res, "NOT_FOUND", "Asset not found", 404);
          return;
        }
        
        res.setHeader("Content-Type", result.meta.mime);
        // Use RFC 5987 encoding for non-ASCII filenames
        const asciiFilename = result.meta.filename.replace(/[^\x20-\x7E]/g, "_");
        const encodedFilename = encodeURIComponent(result.meta.filename);
        res.setHeader(
          "Content-Disposition",
          `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
        );
        res.send(result.buffer);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Get content failed";
        error(res, "GET_CONTENT_FAILED", message, 500);
      }
    },
  );

  /**
   * Get asset kind/info
   * GET /projects/:ownerType/:ownerKey/:projectKey/assets/:assetId/kind
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/assets/:assetId/kind",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, assetId } = req.params;
        const userId = getUserId(req);
        const meta = await assetStore.getMeta(userId, projectKey, assetId);
        
        if (!meta) {
          error(res, "NOT_FOUND", "Asset not found", 404);
          return;
        }
        
        success(res, {
          asset_id: meta.id,
          filename: meta.filename,
          mime: meta.mime,
          size: meta.size,
          kind: getAssetKind(meta.mime),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Get kind failed";
        error(res, "GET_KIND_FAILED", message, 500);
      }
    },
  );

  // ============================================
  // Knowledge Search API
  // ============================================

  /**
   * Search knowledge base
   * POST /projects/:ownerType/:ownerKey/:projectKey/knowledge/search
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/knowledge/search", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const query = req.body as SearchQuery;
      const results = await knowledgeSearch.search(userId, projectKey, query);
      success(res, results);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      error(res, "SEARCH_FAILED", message, 500);
    }
  });

  // ============================================
  // RAG Rebuild APIs
  // ============================================

  /**
   * Start async rebuild of all document indexes for a project
   * POST /projects/:ownerType/:ownerKey/:projectKey/rag/rebuild
   * Returns task ID for progress tracking
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/rag/rebuild", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      
      // Check if rebuild is already running
      if (rebuildTaskManager.isRunning(projectKey)) {
        const activeTask = rebuildTaskManager.getActiveTask(projectKey);
        success(res, {
          taskId: activeTask?.id,
          status: activeTask?.status || "running",
          message: "A rebuild is already in progress",
        });
        return;
      }

      // Get all documents for the project
      const documents = await documentStore.getAllDocuments(userId, projectKey);
      
      if (documents.length === 0) {
        success(res, {
          taskId: null,
          status: "completed",
          total: 0,
          succeeded: 0,
          failed: 0,
        });
        return;
      }

      // Create task and start async rebuild
      const task = rebuildTaskManager.create(projectKey, documents.length);

      // Start rebuild in background (don't await)
      void (async () => {
        try {
          await knowledgeSearch.rebuildAll(userId, projectKey, documents, (progress) => {
            rebuildTaskManager.updateProgress(task.id, {
              processed: progress.processed,
              succeeded: progress.succeeded,
              failed: progress.failed,
            });
          });
          rebuildTaskManager.complete(task.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Rebuild failed";
          rebuildTaskManager.fail(task.id, message);
        }
      })();

      success(res, {
        taskId: task.id,
        status: "pending",
        total: documents.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rebuild failed";
      error(res, "REBUILD_FAILED", message, 500);
    }
  });

  /**
   * Get rebuild task status
   * GET /projects/:ownerType/:ownerKey/:projectKey/rag/rebuild/status
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/rag/rebuild/status", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const task = rebuildTaskManager.getActiveTask(projectKey);
      
      if (!task) {
        success(res, {
          status: "idle",
          message: "No active rebuild task",
        });
        return;
      }

      success(res, {
        taskId: task.id,
        status: task.status,
        total: task.total,
        processed: task.processed,
        succeeded: task.succeeded,
        failed: task.failed,
        errors: task.errors,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        error: task.error,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to get status";
      error(res, "STATUS_FAILED", message, 500);
    }
  });

  /**
   * Rebuild index for a single document
   * POST /projects/:ownerType/:ownerKey/:projectKey/rag/rebuild/documents/:docId
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/rag/rebuild/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      const userId = getUserId(req);
      
      // Get the document
      const doc = await documentStore.get(userId, projectKey, docId);
      
      // Rebuild its index
      await knowledgeSearch.rebuildDocument(userId, projectKey, doc);
      
      success(res, {
        status: "completed",
        docId: doc.meta.id,
      });
    } catch (err) {
      if (err instanceof DocumentNotFoundError) {
        error(res, "NOT_FOUND", err.message, 404);
        return;
      }
      const message = err instanceof Error ? err.message : "Rebuild failed";
      error(res, "REBUILD_FAILED", message, 500);
    }
  });

  // ============================================
  // LLM Gateway APIs
  // ============================================

  /**
   * List available LLM providers
   * GET /llm/providers
   */
  router.get("/llm/providers", (_req: Request, res: Response) => {
    try {
      const providers = llmGateway.listProviders();
      success(res, providers);
    } catch (err) {
      const message = err instanceof Error ? err.message : "List providers failed";
      error(res, "LIST_PROVIDERS_FAILED", message, 500);
    }
  });

  /**
   * List available LLM models
   * GET /llm/models
   */
  router.get("/llm/models", (_req: Request, res: Response) => {
    try {
      const models = llmGateway.listModels();
      success(res, models);
    } catch (err) {
      const message = err instanceof Error ? err.message : "List models failed";
      error(res, "LIST_MODELS_FAILED", message, 500);
    }
  });

  /**
   * Chat with LLM
   * POST /llm/chat
   */
  router.post("/llm/chat", async (req: Request, res: Response) => {
    try {
      const options = req.body as ChatOptions;
      
      if (!options.provider || !options.model || !options.messages) {
        error(res, "INVALID_REQUEST", "provider, model, and messages are required");
        return;
      }

      if (options.stream) {
        // Streaming response
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const stream = await llmGateway.chatStream(options);
        
        for await (const chunk of stream.textStream) {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
        
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        // Non-streaming response
        const result = await llmGateway.chat(options);
        success(res, result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat failed";
      error(res, "CHAT_FAILED", message, 500);
    }
  });

  /**
   * Text completion with LLM
   * POST /llm/complete
   */
  router.post("/llm/complete", async (req: Request, res: Response) => {
    try {
      const options = req.body as CompletionOptions;
      
      if (!options.provider || !options.model || !options.prompt) {
        error(res, "INVALID_REQUEST", "provider, model, and prompt are required");
        return;
      }

      const result = await llmGateway.complete(options);
      success(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Completion failed";
      error(res, "COMPLETION_FAILED", message, 500);
    }
  });

  /**
   * Generate embeddings
   * POST /llm/embed
   */
  router.post("/llm/embed", async (req: Request, res: Response) => {
    try {
      const options = req.body as EmbeddingOptions;
      
      if (!options.provider || !options.model || !options.inputs || !Array.isArray(options.inputs)) {
        error(res, "INVALID_REQUEST", "provider, model, and inputs array are required");
        return;
      }

      const result = await llmGateway.generateEmbeddings(options);
      success(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Embedding failed";
      error(res, "EMBEDDING_FAILED", message, 500);
    }
  });

  // ============================================
  // LLM Provider Configuration APIs
  // ============================================

  /**
   * List all provider configurations
   * GET /llm/configs
   */
  router.get("/llm/configs", async (_req: Request, res: Response) => {
    try {
      const configs = await configStore.list();
      success(res, configs);
    } catch (err) {
      const message = err instanceof Error ? err.message : "List configs failed";
      error(res, "LIST_CONFIGS_FAILED", message, 500);
    }
  });

  /**
   * Get provider configuration by type (llm or embedding)
   * GET /llm/configs/type/:configType
   */
  router.get("/llm/configs/type/:configType", async (req: Request, res: Response) => {
    try {
      const { configType } = req.params;
      
      if (configType !== "llm" && configType !== "embedding" && configType !== "vision") {
        error(res, "INVALID_TYPE", "configType must be 'llm', 'embedding', or 'vision'");
        return;
      }
      
      const config = await configStore.getByType(configType as ConfigType);
      success(res, config); // Returns null if not found, which is valid
    } catch (err) {
      const message = err instanceof Error ? err.message : "Get config failed";
      error(res, "GET_CONFIG_FAILED", message, 500);
    }
  });

  /**
   * Set (upsert) provider configuration by type
   * PUT /llm/configs/type/:configType
   */
  router.put("/llm/configs/type/:configType", async (req: Request, res: Response) => {
    try {
      const { configType } = req.params;
      const input = req.body as Omit<ProviderConfigInput, "configType">;
      
      if (configType !== "llm" && configType !== "embedding" && configType !== "vision") {
        error(res, "INVALID_TYPE", "configType must be 'llm', 'embedding', or 'vision'");
        return;
      }
      
      if (!input.providerId || !input.displayName) {
        error(res, "INVALID_REQUEST", "providerId and displayName are required");
        return;
      }

      // Validate provider ID
      const validProviders: LLMProviderId[] = ["openai", "anthropic", "google", "ollama", "openai-compatible", "paddleocr"];
      if (!validProviders.includes(input.providerId)) {
        error(res, "INVALID_PROVIDER", `Invalid provider: ${input.providerId}`);
        return;
      }

      const config = await configStore.upsertByType(configType as ConfigType, input);
      
      // Refresh provider registry
      await providerRegistry.refresh();
      
      success(res, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upsert config failed";
      error(res, "UPSERT_CONFIG_FAILED", message, 500);
    }
  });

  /**
   * Delete provider configuration by type
   * DELETE /llm/configs/type/:configType
   */
  router.delete("/llm/configs/type/:configType", async (req: Request, res: Response) => {
    try {
      const { configType } = req.params;
      
      if (configType !== "llm" && configType !== "embedding" && configType !== "vision") {
        error(res, "INVALID_TYPE", "configType must be 'llm', 'embedding', or 'vision'");
        return;
      }
      
      const deleted = await configStore.deleteByType(configType as ConfigType);
      
      if (!deleted) {
        error(res, "NOT_FOUND", "Configuration not found", 404);
        return;
      }
      
      // Refresh provider registry
      await providerRegistry.refresh();
      
      success(res, { deleted: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete config failed";
      error(res, "DELETE_CONFIG_FAILED", message, 500);
    }
  });

  /**
   * Test provider configuration by type
   * POST /llm/configs/type/:configType/test
   */
  router.post("/llm/configs/type/:configType/test", async (req: Request, res: Response) => {
    try {
      const { configType } = req.params;
      
      if (configType !== "llm" && configType !== "embedding" && configType !== "vision") {
        error(res, "INVALID_TYPE", "configType must be 'llm', 'embedding', or 'vision'");
        return;
      }
      
      // Get the configuration with decrypted API key
      const config = await configStore.getInternalByType(configType as ConfigType);
      
      if (!config) {
        error(res, "NOT_FOUND", "Configuration not found", 404);
        return;
      }
      
      // Log test request details
      console.log(`[LLM Test] Testing ${configType} provider:`, {
        id: config.id,
        providerId: config.providerId,
        displayName: config.displayName,
        baseUrl: config.baseUrl,
        model: config.defaultModel,
        hasApiKey: !!config.apiKey,
      });
      
      // Test based on config type and provider
      try {
        if (config.providerId === "paddleocr") {
          // Test PaddleOCR by calling its health endpoint
          console.log(`[OCR Test] Testing PaddleOCR at ${config.baseUrl}...`);
          const healthUrl = `${config.baseUrl}/api/ocr/health`;
          const response = await fetch(healthUrl, { 
            method: "GET",
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) {
            throw new Error(`PaddleOCR health check failed: ${response.status} ${response.statusText}`);
          }
          const data = await response.json() as { status?: string };
          if (data.status !== "healthy") {
            throw new Error(`PaddleOCR is not healthy: ${JSON.stringify(data)}`);
          }
          console.log(`[OCR Test] PaddleOCR health check passed`);
        } else if (configType === "embedding") {
          // Test embedding
          console.log(`[LLM Test] Calling embedding API...`);
          await llmGateway.generateEmbeddings({
            inputs: ["test"],
            model: config.defaultModel || "nomic-embed-text",
            provider: config.providerId,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
          });
        } else {
          // Test LLM chat (for LLM and vision types with LLM providers)
          console.log(`[LLM Test] Calling chat API...`);
          await llmGateway.chat({
            messages: [{ role: "user", content: "Hi" }],
            model: config.defaultModel || "gpt-4o",
            provider: config.providerId,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
          });
        }
        
        console.log(`[LLM Test] Test succeeded for ${config.displayName}`);
        await configStore.updateStatus(config.id, "active");
        const updated = await configStore.getByType(configType as ConfigType);
        success(res, { success: true, config: updated });
      } catch (testErr) {
        // Log detailed error information
        const testMessage = testErr instanceof Error ? testErr.message : "Test failed";
        console.error(`[LLM Test] Test failed for ${config.displayName}:`, testMessage);
        if (testErr instanceof Error) {
          console.error(`[LLM Test] Error stack:`, testErr.stack);
          // Log cause if available
          if (testErr.cause) {
            console.error(`[LLM Test] Error cause:`, testErr.cause);
          }
        }
        // Log the full error object for debugging
        console.error(`[LLM Test] Full error object:`, JSON.stringify(testErr, Object.getOwnPropertyNames(testErr), 2));
        
        await configStore.updateStatus(config.id, "error", testMessage);
        const updated = await configStore.getByType(configType as ConfigType);
        success(res, { success: false, error: testMessage, config: updated });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Test config failed";
      console.error(`[LLM Test] Unexpected error:`, err);
      error(res, "TEST_CONFIG_FAILED", message, 500);
    }
  });

  /**
   * Get a single provider configuration
   * GET /llm/configs/:id
   */
  router.get("/llm/configs/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const config = await configStore.get(id);
      
      if (!config) {
        error(res, "NOT_FOUND", "Configuration not found", 404);
        return;
      }
      
      success(res, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Get config failed";
      error(res, "GET_CONFIG_FAILED", message, 500);
    }
  });

  /**
   * Create a new provider configuration
   * POST /llm/configs
   */
  router.post("/llm/configs", async (req: Request, res: Response) => {
    try {
      const input = req.body as ProviderConfigInput;
      
      if (!input.providerId || !input.displayName) {
        error(res, "INVALID_REQUEST", "providerId and displayName are required");
        return;
      }

      // Validate provider ID
      const validProviders: LLMProviderId[] = ["openai", "anthropic", "google", "ollama", "openai-compatible", "paddleocr"];
      if (!validProviders.includes(input.providerId)) {
        error(res, "INVALID_PROVIDER", `Invalid provider: ${input.providerId}`);
        return;
      }

      const config = await configStore.create(input);
      
      // Refresh provider registry
      await providerRegistry.refresh();
      
      success(res, config, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Create config failed";
      error(res, "CREATE_CONFIG_FAILED", message, 500);
    }
  });

  /**
   * Update a provider configuration
   * PUT /llm/configs/:id
   */
  router.put("/llm/configs/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const input = req.body as Partial<ProviderConfigInput>;

      const config = await configStore.update(id, input);
      
      // Refresh provider registry
      await providerRegistry.refresh();
      
      success(res, config);
    } catch (err) {
      if (err instanceof Error && err.message.includes("not found")) {
        error(res, "NOT_FOUND", err.message, 404);
        return;
      }
      const message = err instanceof Error ? err.message : "Update config failed";
      error(res, "UPDATE_CONFIG_FAILED", message, 500);
    }
  });

  /**
   * Delete a provider configuration
   * DELETE /llm/configs/:id
   */
  router.delete("/llm/configs/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await configStore.delete(id);
      
      if (!deleted) {
        error(res, "NOT_FOUND", "Configuration not found", 404);
        return;
      }
      
      // Refresh provider registry
      await providerRegistry.refresh();
      
      success(res, { deleted: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Delete config failed";
      error(res, "DELETE_CONFIG_FAILED", message, 500);
    }
  });

  /**
   * Test a provider configuration
   * POST /llm/configs/:id/test
   */
  router.post("/llm/configs/:id/test", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      
      // Get the configuration with decrypted API key
      const config = await configStore.getInternal(id);
      if (!config) {
        error(res, "NOT_FOUND", "Configuration not found", 404);
        return;
      }

      // Get model to test with
      const model = config.defaultModel || getDefaultModelForProvider(config.providerId);
      if (!model) {
        error(res, "NO_MODEL", "No model configured for testing");
        return;
      }

      // Try a simple chat request
      try {
        console.log(`[test] Testing provider=${config.providerId} model=${model} baseUrl=${config.baseUrl}`);
        const result = await llmGateway.chat({
          provider: config.providerId,
          model,
          messages: [{ role: "user", content: "Hello" }],
          maxTokens: 10,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
        });

        // Update status to active
        await configStore.updateStatus(id, "active");
        
        console.log(`[test] Success: ${result.content.substring(0, 50)}`);
        success(res, {
          success: true,
          model,
          response: result.content.substring(0, 100),
        });
      } catch (testErr) {
        // Update status to error
        const errorMessage = testErr instanceof Error ? testErr.message : "Test failed";
        console.error(`[test] Failed:`, testErr);
        await configStore.updateStatus(id, "error", errorMessage);
        
        error(res, "TEST_FAILED", errorMessage);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Test failed";
      error(res, "TEST_FAILED", message, 500);
    }
  });

  /**
   * Fetch models from Ollama API
   * GET /llm/ollama/models?baseUrl=http://localhost:11434
   */
  router.get("/llm/ollama/models", async (req: Request, res: Response) => {
    try {
      const baseUrl = (req.query.baseUrl as string) || "http://localhost:11434";
      const apiUrl = `${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`;
      
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        error(res, "OLLAMA_ERROR", `Ollama API error: ${response.status}`, response.status);
        return;
      }

      const data = await response.json() as { models?: Array<{ name: string; model: string; size: number; modified_at: string }> };
      const models = (data.models || []).map((m) => ({
        id: m.name.replace(/:latest$/, ""),
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
      }));

      success(res, models);
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        error(res, "OLLAMA_TIMEOUT", "Ollama 服务连接超时，请确保 Ollama 正在运行", 504);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to fetch Ollama models";
      error(res, "OLLAMA_ERROR", message, 500);
    }
  });

  /**
   * Get available provider types (static list)
   * GET /llm/provider-types
   */
  router.get("/llm/provider-types", (_req: Request, res: Response) => {
    const types = [
      {
        id: "openai",
        name: "OpenAI",
        description: "OpenAI GPT models (GPT-4, GPT-3.5, etc.)",
        requiresApiKey: true,
        supportsBaseUrl: true,
        defaultModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
      },
      {
        id: "anthropic",
        name: "Anthropic",
        description: "Anthropic Claude models",
        requiresApiKey: true,
        supportsBaseUrl: true,
        defaultModels: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
      },
      {
        id: "google",
        name: "Google",
        description: "Google Gemini models",
        requiresApiKey: true,
        supportsBaseUrl: true,
        defaultModels: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
      },
      {
        id: "ollama",
        name: "Ollama",
        description: "本地 Ollama 服务 (Llama, Qwen, DeepSeek 等)",
        requiresApiKey: false,
        supportsBaseUrl: true,
        requiresBaseUrl: true,
        defaultBaseUrl: "http://localhost:11434",
        defaultModels: [],
        dynamicModels: true,
      },
      {
        id: "openai-compatible",
        name: "OpenAI Compatible",
        description: "Any OpenAI-compatible API (DeepSeek, Qwen, Moonshot, etc.)",
        requiresApiKey: true,
        supportsBaseUrl: true,
        requiresBaseUrl: true,
        defaultModels: [],
      },
      {
        id: "paddleocr",
        name: "PaddleOCR",
        description: "PaddleOCR 文档识别服务 (本地或远程)",
        requiresApiKey: false,
        supportsBaseUrl: true,
        requiresBaseUrl: true,
        defaultBaseUrl: "http://localhost:8001",
        defaultModels: [],
        ocrOnly: true,
      },
    ];
    success(res, types);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // OCR API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Parse image using OCR
   * POST /ocr/parse
   * 
   * Supports multiple OCR providers:
   * - llm: Use configured LLM vision model
   * - paddle: Use PaddleOCR-VL service
   * - auto (default): Prefer PaddleOCR if available, fallback to LLM
   */
  router.post("/ocr/parse", async (req: Request, res: Response) => {
    try {
      const { image, output_format, language, provider } = req.body as {
        image?: string;
        output_format?: "tiptap" | "markdown";
        language?: string;
        provider?: "llm" | "paddle";
      };

      if (!image || typeof image !== "string") {
        error(res, "INVALID_REQUEST", "image is required (base64 data URL or HTTP URL)");
        return;
      }

      // Dynamic import to avoid circular dependency
      const { ocrService } = await import("./services/ocr.js");

      const result = await ocrService.parseImage({
        image,
        outputFormat: output_format,
        language,
        provider,
      });

      success(res, {
        content: result.content,
        markdown: result.markdown,
        provider: result.provider,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "OCR failed";
      console.error("[OCR API] Error:", message, err);
      error(res, "OCR_FAILED", message, 500);
    }
  });

  /**
   * Check if any OCR provider is available (LLM vision or PaddleOCR)
   * GET /ocr/available
   */
  router.get("/ocr/available", async (_req: Request, res: Response) => {
    try {
      const { ocrService } = await import("./services/ocr.js");
      const [visionAvailable, paddleAvailable] = await Promise.all([
        ocrService.isVisionAvailable(),
        ocrService.isPaddleOCRAvailable(),
      ]);
      success(res, { available: visionAvailable || paddleAvailable });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Check failed";
      error(res, "CHECK_FAILED", message, 500);
    }
  });

  /**
   * Get OCR provider status
   * GET /ocr/status
   */
  router.get("/ocr/status", async (_req: Request, res: Response) => {
    try {
      const { ocrService } = await import("./services/ocr.js");
      const status = await ocrService.getProviderStatus();
      success(res, status);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Status check failed";
      error(res, "STATUS_FAILED", message, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Chat API (project-scoped)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a chat run
   * POST /projects/:ownerType/:ownerKey/:projectKey/chat/runs
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/chat/runs", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const { session_id, message, document_scope, deep_search, attachments } = req.body as { 
        session_id?: string; 
        message?: string;
        document_scope?: Array<{ doc_id: string; include_children: boolean }>;
        deep_search?: boolean;
        attachments?: Array<{
          asset_id?: string;
          name?: string;
          mime_type?: string;
          size?: number;
          type?: string;
        }>;
      };

      if (!message || typeof message !== "string" || !message.trim()) {
        error(res, "INVALID_REQUEST", "message is required");
        return;
      }

      // Use provided session_id or generate one
      const sessionId = session_id || `session-${uuidv4()}`;

      // Parse document scope
      const docScope = Array.isArray(document_scope)
        ? document_scope
            .filter((s) => s && typeof s.doc_id === "string" && s.doc_id.trim())
            .map((s) => ({
              docId: s.doc_id.trim(),
              includeChildren: Boolean(s.include_children),
            }))
        : undefined;

      const normalizedAttachments = Array.isArray(attachments)
        ? attachments
            .map((a) => ({
              assetId: typeof a?.asset_id === "string" ? a.asset_id.trim() : "",
              name: typeof a?.name === "string" ? a.name : undefined,
              mimeType: typeof a?.mime_type === "string" ? a.mime_type : undefined,
              size: typeof a?.size === "number" ? a.size : undefined,
              type: typeof a?.type === "string" ? a.type : undefined,
            }))
            .filter((a) => a.assetId)
        : undefined;

      const runId = await createRun(userId, projectKey, sessionId, message.trim(), docScope, {
        deepSearch: deep_search === true,
        attachments: normalizedAttachments,
      });

      success(res, { run_id: runId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create chat run";
      error(res, "CREATE_RUN_FAILED", msg, 500);
    }
  });

  /**
   * Stream a chat run response (SSE)
   * GET /projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/stream
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/stream", async (req: Request, res: Response) => {
    const { runId } = req.params;

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Listen for client disconnect to cancel the run
    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
      const cancelled = cancelRun(runId);
      if (cancelled) {
        console.log(`[chat-stream] Client disconnected, cancelled run ${runId}`);
      }
    });

    try {
      const run = getRun(runId);
      if (!run) {
        res.write(`event: run.error\ndata: ${JSON.stringify({ error: "Run not found" })}\n\n`);
        res.end();
        return;
      }

      // Stream the response
      for await (const chunk of streamRun(runId)) {
        // Stop writing if client disconnected
        if (clientDisconnected) {
          break;
        }

        if (chunk.type === "delta") {
          res.write(`event: assistant.delta\ndata: ${JSON.stringify(chunk.content)}\n\n`);
        } else if (chunk.type === "thinking") {
          const payload = {
            content: chunk.content,
            phase: chunk.phase,
            subQueries: chunk.subQueries,
            searchQuery: chunk.searchQuery,
            resultCount: chunk.resultCount,
          };
          res.write(`event: assistant.thinking\ndata: ${JSON.stringify(payload)}\n\n`);
        } else if (chunk.type === "search_start") {
          res.write(`event: assistant.search_start\ndata: ${JSON.stringify({
            content: chunk.content,
            phase: chunk.phase,
            searchQuery: chunk.searchQuery,
          })}\n\n`);
        } else if (chunk.type === "search_result") {
          res.write(`event: assistant.search_result\ndata: ${JSON.stringify({
            content: chunk.content,
            phase: chunk.phase,
            searchQuery: chunk.searchQuery,
            resultCount: chunk.resultCount,
          })}\n\n`);
        } else if (chunk.type === "draft") {
          res.write(`event: assistant.draft\ndata: ${JSON.stringify(chunk.draft)}\n\n`);
        } else if (chunk.type === "done") {
          res.write(`event: assistant.done\ndata: ${JSON.stringify({
            message: chunk.message,
            sources: chunk.sources || [],
          })}\n\n`);
        } else if (chunk.type === "tool_pending") {
          res.write(`event: assistant.tool_pending\ndata: ${JSON.stringify(chunk.pendingTool)}\n\n`);
        } else if (chunk.type === "intent_pending") {
          res.write(`event: assistant.intent_pending\ndata: ${JSON.stringify(chunk.pendingIntent)}\n\n`);
        } else if (chunk.type === "preflight_pending") {
          res.write(`event: assistant.preflight_pending\ndata: ${JSON.stringify(chunk.pendingPreflight)}\n\n`);
        } else if (chunk.type === "input_pending") {
          res.write(`event: assistant.input_pending\ndata: ${JSON.stringify(chunk.pendingInput)}\n\n`);
        } else if (chunk.type === "tool_rejected") {
          res.write(`event: assistant.tool_rejected\ndata: ${JSON.stringify({ message: chunk.message })}\n\n`);
        } else if (chunk.type === "error") {
          res.write(`event: run.error\ndata: ${JSON.stringify({ error: chunk.error })}\n\n`);
        }
      }

      if (!clientDisconnected) {
        res.end();
      }
    } catch (err) {
      if (!clientDisconnected) {
        const msg = err instanceof Error ? err.message : "Stream failed";
        res.write(`event: run.error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
        res.end();
      }
    }
  });

  /**
   * Cancel a chat run
   * DELETE /projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId
   */
  router.delete("/projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const cancelled = cancelRun(runId);
      success(res, { cancelled });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to cancel run";
      error(res, "CANCEL_RUN_FAILED", msg, 500);
    }
  });

  /**
   * Confirm a pending tool execution
   * POST /projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/confirm-tool
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/confirm-tool", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const confirmed = confirmTool(runId);
      if (!confirmed) {
        error(res, "NOT_FOUND", "No pending tool confirmation for this run", 404);
        return;
      }
      success(res, { confirmed: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to confirm tool";
      error(res, "CONFIRM_TOOL_FAILED", msg, 500);
    }
  });

  /**
   * Reject a pending tool execution
   * POST /projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/reject-tool
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/reject-tool", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const rejected = rejectTool(runId);
      if (!rejected) {
        error(res, "NOT_FOUND", "No pending tool confirmation for this run", 404);
        return;
      }
      success(res, { rejected: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reject tool";
      error(res, "REJECT_TOOL_FAILED", msg, 500);
    }
  });

  /**
   * Select an intent option for a pending intent clarification
   * POST /projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/select-intent
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/select-intent", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const option = req.body as { type?: string; skillHint?: string; label?: string; confidence?: number };
      if (!option?.type) {
        error(res, "INVALID_REQUEST", "option.type is required");
        return;
      }
      const selected = selectIntent(runId, {
        type: option.type as "command" | "skill" | "deep_search" | "chat",
        skillHint: option.skillHint,
        label: option.label || option.type,
        confidence: option.confidence ?? 1.0,
      });
      if (!selected) {
        error(res, "NOT_FOUND", "No pending intent selection for this run", 404);
        return;
      }
      success(res, { selected: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to select intent";
      error(res, "SELECT_INTENT_FAILED", msg, 500);
    }
  });

  /**
   * Provide required input for a pending input clarification (e.g. doc scope)
   * POST /projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/provide-input
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/provide-input", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const raw = req.body as unknown;
      const payload: Record<string, unknown> =
        raw && typeof raw === "object" && raw !== null
          ? (raw as Record<string, unknown>)
          : {};

      // Normalize common fields
      if (typeof payload.doc_id === "string") {
        payload.doc_id = payload.doc_id.trim();
      }

      if ("args" in payload) {
        const args = (payload as { args?: unknown }).args;
        if (!args || typeof args !== "object" || Array.isArray(args)) {
          payload.args = {};
        }
      }

      const ok = provideRequiredInput(runId, payload);
      if (!ok) {
        error(res, "NOT_FOUND", "No pending input for this run", 404);
        return;
      }
      success(res, { provided: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to provide input";
      error(res, "PROVIDE_INPUT_FAILED", msg, 500);
    }
  });

  /**
   * Provide preflight input for pending preflight clarification.
   * POST /projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/provide-preflight-input
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/chat/runs/:runId/provide-preflight-input", async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const raw = req.body as unknown;
      const payload: Record<string, unknown> =
        raw && typeof raw === "object" && raw !== null
          ? (raw as Record<string, unknown>)
          : {};

      const normalizedTaskInputs = Array.isArray(payload.taskInputs)
        ? payload.taskInputs
            .filter((item) => item && typeof item === "object")
            .map((item) => {
              const input = item as Record<string, unknown>;
              const taskId = typeof input.taskId === "string" ? input.taskId.trim() : "";
              const docId = typeof input.doc_id === "string" ? input.doc_id.trim() : undefined;
              const args = input.args && typeof input.args === "object" && !Array.isArray(input.args)
                ? input.args
                : undefined;
              return {
                ...(taskId ? { taskId } : {}),
                ...(docId !== undefined ? { doc_id: docId } : {}),
                ...(args ? { args } : {}),
              };
            })
        : [];

      const ok = providePreflightInput(runId, { taskInputs: normalizedTaskInputs });
      if (!ok) {
        error(res, "NOT_FOUND", "No pending preflight input for this run", 404);
        return;
      }
      success(res, { provided: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to provide preflight input";
      error(res, "PROVIDE_PREFLIGHT_INPUT_FAILED", msg, 500);
    }
  });

  /**
   * List chat sessions
   * GET /projects/:ownerType/:ownerKey/:projectKey/chat/sessions
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/chat/sessions", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const { chatSessionStore } = await import("./services/chat-session-store.js");
      const sessions = await chatSessionStore.listSessions(userId, projectKey, limit, offset);
      success(res, { sessions });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list sessions";
      error(res, "LIST_SESSIONS_FAILED", msg, 500);
    }
  });

  /**
   * Create a new chat session
   * POST /projects/:ownerType/:ownerKey/:projectKey/chat/sessions
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/chat/sessions", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const { title } = req.body as { title?: string };

      const { chatSessionStore } = await import("./services/chat-session-store.js");
      const session = await chatSessionStore.createSession(userId, projectKey, title || undefined);
      success(res, session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create session";
      error(res, "CREATE_SESSION_FAILED", msg, 500);
    }
  });

  /**
   * Get messages for a chat session
   * GET /projects/:ownerType/:ownerKey/:projectKey/chat/sessions/:sessionId/messages
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/chat/sessions/:sessionId/messages", async (req: Request, res: Response) => {
    try {
      const { sessionId, projectKey } = req.params;
      const userId = getUserId(req);

      const { chatSessionStore } = await import("./services/chat-session-store.js");
      const messages = await chatSessionStore.getMessages(userId, projectKey, sessionId);
      success(res, { messages });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get session messages";
      error(res, "GET_SESSION_MESSAGES_FAILED", msg, 500);
    }
  });

  /**
   * Rename a chat session
   * PATCH /projects/:ownerType/:ownerKey/:projectKey/chat/sessions/:sessionId
   */
  router.patch("/projects/:ownerType/:ownerKey/:projectKey/chat/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId, projectKey } = req.params;
      const userId = getUserId(req);
      const { title } = req.body as { title?: string };

      if (!title || typeof title !== "string" || !title.trim()) {
        error(res, "INVALID_REQUEST", "title is required");
        return;
      }

      const { chatSessionStore } = await import("./services/chat-session-store.js");
      const session = await chatSessionStore.renameSession(userId, projectKey, sessionId, title.trim());
      if (!session) {
        error(res, "NOT_FOUND", "Session not found", 404);
        return;
      }
      success(res, session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to rename session";
      error(res, "RENAME_SESSION_FAILED", msg, 500);
    }
  });

  /**
   * Delete a chat session (replaces old clear-session endpoint)
   * DELETE /projects/:ownerType/:ownerKey/:projectKey/chat/sessions/:sessionId
   */
  router.delete("/projects/:ownerType/:ownerKey/:projectKey/chat/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId, projectKey } = req.params;
      const userId = getUserId(req);

      // Clear in-memory cache
      clearSession(sessionId);

      // Delete from DB (cascade deletes messages)
      const { chatSessionStore } = await import("./services/chat-session-store.js");
      await chatSessionStore.deleteSession(userId, projectKey, sessionId);

      success(res, { deleted: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete session";
      error(res, "DELETE_SESSION_FAILED", msg, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Draft API (for AI-generated document changes)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a draft by ID
   * GET /projects/:ownerType/:ownerKey/:projectKey/drafts/:draftId
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/drafts/:draftId", async (req: Request, res: Response) => {
    try {
      const { projectKey, draftId } = req.params;
      const draft = draftService.get(draftId);

      if (!draft) {
        error(res, "NOT_FOUND", "Draft not found or expired", 404);
        return;
      }

      if (draft.projectKey !== projectKey) {
        error(res, "FORBIDDEN", "Draft does not belong to this project", 403);
        return;
      }

      success(res, draft);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get draft";
      error(res, "GET_DRAFT_FAILED", msg, 500);
    }
  });

  /**
   * Apply a draft (save the document)
   * POST /projects/:ownerType/:ownerKey/:projectKey/drafts/:draftId/apply
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/drafts/:draftId/apply", async (req: Request, res: Response) => {
    try {
      const { projectKey, draftId } = req.params;
      const { modifiedContent, parentId, saveAsNew, newTitle } = req.body as {
        modifiedContent?: unknown;
        parentId?: string | null;
        saveAsNew?: boolean;
        newTitle?: string;
      };

      // Validate modified content if provided
      let validatedContent: JSONContent | undefined = undefined;
      if (modifiedContent && typeof modifiedContent === "object") {
        validatedContent = modifiedContent as JSONContent;
      }

      const result = await draftService.apply(projectKey, draftId, {
        modifiedContent: validatedContent,
        parentId,
        saveAsNew,
        newTitle,
      });

      success(res, {
        docId: result.docId,
        isNew: result.isNew,
        applied: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to apply draft";
      error(res, "APPLY_DRAFT_FAILED", msg, 500);
    }
  });

  /**
   * Reject a draft
   * DELETE /projects/:ownerType/:ownerKey/:projectKey/drafts/:draftId
   */
  router.delete("/projects/:ownerType/:ownerKey/:projectKey/drafts/:draftId", async (req: Request, res: Response) => {
    try {
      const { projectKey, draftId } = req.params;
      const draft = draftService.get(draftId);

      if (!draft) {
        error(res, "NOT_FOUND", "Draft not found or expired", 404);
        return;
      }

      if (draft.projectKey !== projectKey) {
        error(res, "FORBIDDEN", "Draft does not belong to this project", 403);
        return;
      }

      draftService.reject(draftId);
      draftService.delete(draftId);

      success(res, { rejected: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reject draft";
      error(res, "REJECT_DRAFT_FAILED", msg, 500);
    }
  });

  /**
   * List pending drafts for a project
   * GET /projects/:ownerType/:ownerKey/:projectKey/drafts
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/drafts", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const drafts = draftService.listPending(projectKey);
      success(res, drafts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list drafts";
      error(res, "LIST_DRAFTS_FAILED", msg, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Skills Configuration API
  // ─────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────
  // Plugin APIs
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List plugins from store (v2)
   * GET /plugins/v2/store?q=keyword
   */
  router.get("/plugins/v2/store", async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || "");
      const plugins = await pluginManager.listStorePlugins(q);
      success(res, { plugins });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list plugin store";
      error(res, "LIST_PLUGIN_STORE_FAILED", msg, 500);
    }
  });

  /**
   * List plugin versions from store (v2)
   * GET /plugins/v2/store/:pluginId/versions
   */
  router.get("/plugins/v2/store/:pluginId/versions", async (req: Request, res: Response) => {
    try {
      const pluginId = decodeURIComponent(String(req.params.pluginId || "").trim());
      if (!pluginId) {
        error(res, "INVALID_REQUEST", "pluginId is required");
        return;
      }
      const versions = await pluginManager.listStorePluginVersions(pluginId);
      success(res, { versions });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list plugin versions";
      error(res, "LIST_PLUGIN_VERSIONS_FAILED", msg, 500);
    }
  });

  /**
   * List current user's plugins (v2)
   * GET /plugins/v2/me
   */
  router.get("/plugins/v2/me", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const plugins = await pluginManager.listUserPlugins(userId);
      success(
        res,
        plugins.map((item) => ({
          installation: item.installation,
          manifest: item.manifest,
        })),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list installed plugins";
      error(res, "LIST_INSTALLED_PLUGINS_FAILED", msg, 500);
    }
  });

  /**
   * Install a plugin for current user (v2)
   * POST /plugins/v2/me/install
   */
  router.post("/plugins/v2/me/install", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const pluginId = String(req.body?.pluginId || "").trim();
      const version = String(req.body?.version || "").trim() || undefined;
      if (!pluginId) {
        error(res, "INVALID_REQUEST", "pluginId is required");
        return;
      }

      const result = await pluginManager.installPlugin(userId, pluginId, version);
      success(res, result, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to install plugin";
      error(res, "INSTALL_PLUGIN_FAILED", msg, 500);
    }
  });

  /**
   * Toggle plugin enabled state (v2)
   * PATCH /plugins/v2/me/:pluginId
   */
  router.patch("/plugins/v2/me/:pluginId", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const pluginId = decodeURIComponent(String(req.params.pluginId || "").trim());
      const enabled = req.body?.enabled;
      if (typeof enabled !== "boolean") {
        error(res, "INVALID_REQUEST", "enabled must be boolean");
        return;
      }
      const installation = await pluginManager.setPluginEnabled(userId, pluginId, enabled);
      success(res, installation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update plugin state";
      error(res, "UPDATE_PLUGIN_STATE_FAILED", msg, 500);
    }
  });

  /**
   * Uninstall plugin (v2)
   * DELETE /plugins/v2/me/:pluginId
   */
  router.delete("/plugins/v2/me/:pluginId", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const pluginId = decodeURIComponent(String(req.params.pluginId || "").trim());
      const deleted = await pluginManager.uninstallPlugin(userId, pluginId);
      success(res, { deleted });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to uninstall plugin";
      error(res, "UNINSTALL_PLUGIN_FAILED", msg, 500);
    }
  });

  /**
   * Runtime manifest for current user (v2)
   * GET /plugins/v2/me/runtime
   */
  router.get("/plugins/v2/me/runtime", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const items = await pluginManager.getRuntimeForUser(userId);
      success(res, { plugins: items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get plugin runtime";
      error(res, "GET_PLUGIN_RUNTIME_FAILED", msg, 500);
    }
  });

  /**
   * Runtime command registry for current user (v2)
   * GET /plugins/v2/me/commands
   */
  router.get("/plugins/v2/me/commands", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const commands = await pluginManager.getRuntimeCommandsForUser(userId);
      success(res, { commands });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list plugin commands";
      error(res, "LIST_PLUGIN_COMMANDS_FAILED", msg, 500);
    }
  });

  /**
   * Get plugin settings for current user (v2)
   * GET /plugins/v2/me/:pluginId/settings
   */
  router.get("/plugins/v2/me/:pluginId/settings", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const pluginId = decodeURIComponent(String(req.params.pluginId || "").trim());
      const settings = await pluginManager.getPluginSettings(userId, pluginId);
      success(res, { settings });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get plugin settings";
      error(res, "GET_PLUGIN_SETTINGS_FAILED", msg, 500);
    }
  });

  /**
   * Update plugin settings for current user (v2)
   * PUT /plugins/v2/me/:pluginId/settings
   */
  router.put("/plugins/v2/me/:pluginId/settings", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const pluginId = decodeURIComponent(String(req.params.pluginId || "").trim());
      const settings = req.body && typeof req.body === "object"
        ? req.body as Record<string, unknown>
        : {};
      const next = await pluginManager.setPluginSettings(userId, pluginId, settings);
      success(res, { settings: next });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update plugin settings";
      error(res, "UPDATE_PLUGIN_SETTINGS_FAILED", msg, 500);
    }
  });

  /**
   * Serve plugin frontend assets for current user (v2)
   * GET /plugins/v2/assets/:pluginId/:version/*
   */
  router.get("/plugins/v2/assets/:pluginId/:version/*", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const pluginId = decodeURIComponent(String(req.params.pluginId || "").trim());
      const version = decodeURIComponent(String(req.params.version || "").trim());
      const assetPath = String(req.params[0] || "").trim();
      if (!assetPath) {
        error(res, "INVALID_REQUEST", "asset path is required");
        return;
      }

      const asset = await pluginManager.readAsset(userId, pluginId, version, assetPath);
      res.setHeader("Content-Type", asset.mime);
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(asset.content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to read plugin asset";
      error(res, "READ_PLUGIN_ASSET_FAILED", msg, 404);
    }
  });

  /**
   * Execute plugin command in project scope (v2)
   * POST /projects/:ownerType/:ownerKey/:projectKey/plugin-commands/:commandId/execute
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/plugin-commands/:commandId/execute",
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { projectKey } = req.params;
        const commandId = decodeURIComponent(String(req.params.commandId || "").trim());
        const rawBody = req.body && typeof req.body === "object"
          ? { ...(req.body as Record<string, unknown>) }
          : {};
        const sourceRaw = String(rawBody.__source || "").trim().toLowerCase();
        delete rawBody.__source;
        const source = (sourceRaw === "palette" || sourceRaw === "tool" || sourceRaw === "api")
          ? sourceRaw as "api" | "palette" | "tool"
          : "api";
        const requestId = `plugin-command-${uuidv4()}`;

        const data = await pluginManager.executeCommand({
          userId,
          projectKey,
          commandId,
          args: rawBody,
          source,
          requestId,
        });
        success(res, data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to execute plugin command";
        if (/requires doc_id/i.test(msg)) {
          error(res, "INVALID_REQUEST", msg, 400);
          return;
        }
        if (/not available/i.test(msg)) {
          error(res, "NOT_FOUND", msg, 404);
          return;
        }
        if (/not enabled for api execution/i.test(msg)) {
          error(res, "FORBIDDEN", msg, 403);
          return;
        }
        error(res, "EXECUTE_PLUGIN_COMMAND_FAILED", msg, 500);
      }
    },
  );

  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/plugin-commands/:commandId\\:execute",
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { projectKey } = req.params;
        const commandId = decodeURIComponent(String(req.params.commandId || "").trim());
        const rawBody = req.body && typeof req.body === "object"
          ? { ...(req.body as Record<string, unknown>) }
          : {};
        const sourceRaw = String(rawBody.__source || "").trim().toLowerCase();
        delete rawBody.__source;
        const source = (sourceRaw === "palette" || sourceRaw === "tool" || sourceRaw === "api")
          ? sourceRaw as "api" | "palette" | "tool"
          : "api";
        const requestId = `plugin-command-${uuidv4()}`;

        const data = await pluginManager.executeCommand({
          userId,
          projectKey,
          commandId,
          args: rawBody,
          source,
          requestId,
        });
        success(res, data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to execute plugin command";
        if (/requires doc_id/i.test(msg)) {
          error(res, "INVALID_REQUEST", msg, 400);
          return;
        }
        if (/not available/i.test(msg)) {
          error(res, "NOT_FOUND", msg, 404);
          return;
        }
        if (/not enabled for api execution/i.test(msg)) {
          error(res, "FORBIDDEN", msg, 403);
          return;
        }
        error(res, "EXECUTE_PLUGIN_COMMAND_FAILED", msg, 500);
      }
    },
  );

  /**
   * Get all skills grouped by category
   * GET /skills
   */
  router.get("/skills", async (_req: Request, res: Response) => {
    try {
      const categories = await skillConfigStore.listByCategory();
      success(res, { categories });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list skills";
      error(res, "LIST_SKILLS_FAILED", msg, 500);
    }
  });

  /**
   * Get enabled skill commands (for frontend filtering)
   * GET /skills/enabled-commands
   */
  router.get("/skills/enabled-commands", async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const commands = await skillConfigStore.getEnabledCommands();
      const pluginCommands = await pluginManager.listEnabledSlashCommandsForUser(userId);
      const merged = new Set(commands);
      for (const command of pluginCommands) {
        merged.add(command);
      }
      success(res, { commands: Array.from(merged).sort((a, b) => a.localeCompare(b)) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get enabled commands";
      error(res, "GET_COMMANDS_FAILED", msg, 500);
    }
  });

  /**
   * Update skill enabled status
   * PATCH /skills/:skillName
   */
  router.patch("/skills/:skillName", async (req: Request, res: Response) => {
    try {
      const { skillName } = req.params;
      const { enabled } = req.body as { enabled?: boolean };

      if (typeof enabled !== "boolean") {
        error(res, "INVALID_REQUEST", "enabled must be a boolean");
        return;
      }

      const config = await skillConfigStore.updateEnabled(skillName, enabled);
      success(res, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update skill";
      error(res, "UPDATE_SKILL_FAILED", msg, 500);
    }
  });

  /**
   * Batch update skill enabled status
   * PATCH /skills
   */
  router.patch("/skills", async (req: Request, res: Response) => {
    try {
      const { updates } = req.body as {
        updates?: Array<{ skillName: string; enabled: boolean }>;
      };

      if (!Array.isArray(updates)) {
        error(res, "INVALID_REQUEST", "updates must be an array");
        return;
      }

      await skillConfigStore.batchUpdateEnabled(updates);
      success(res, { success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to batch update skills";
      error(res, "BATCH_UPDATE_FAILED", msg, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Anthropic Skills Configuration API (Extended Skills)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all skills (Native + Anthropic) grouped by category
   * GET /skills/all
   */
  router.get("/skills/all", async (_req: Request, res: Response) => {
    try {
      const categories = await skillConfigStore.listAllByCategory();
      success(res, { categories });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list all skills";
      error(res, "LIST_ALL_SKILLS_FAILED", msg, 500);
    }
  });

  /**
   * Get Anthropic skills with their config
   * GET /skills/anthropic
   */
  router.get("/skills/anthropic", async (_req: Request, res: Response) => {
    try {
      const skillInfos = await skillConfigStore.listAnthropicSkillInfo();
      const skills = skillInfos.map(({ skill, config, isConfigurable }) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category || "general",
        source: skill.source,
        sourcePath: skill.sourcePath,
        triggers: skill.triggers,
        enabled: config.enabled,
        isConfigurable,
        loadedAt: skill.loadedAt,
      }));
      success(res, { skills });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list Anthropic skills";
      error(res, "LIST_ANTHROPIC_SKILLS_FAILED", msg, 500);
    }
  });

  /**
   * Update Anthropic skill enabled status
   * PATCH /skills/anthropic/:skillId
   */
  router.patch("/skills/anthropic/:skillId", async (req: Request, res: Response) => {
    try {
      const { skillId } = req.params;
      const { enabled } = req.body as { enabled?: boolean };

      if (typeof enabled !== "boolean") {
        error(res, "INVALID_REQUEST", "enabled must be a boolean");
        return;
      }

      const config = await skillConfigStore.updateAnthropicSkillEnabled(skillId, enabled);
      success(res, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update Anthropic skill";
      error(res, "UPDATE_ANTHROPIC_SKILL_FAILED", msg, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Project-Scoped Skills API (System Agent)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all project skills grouped by category
   * GET /projects/:ownerType/:ownerKey/:projectKey/skills
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/skills", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      await agentSkillCatalog.initialize();
      await agentSkillCatalog.refreshPluginSkillsForUser(userId);
      const skills = agentSkillCatalog.getAllSkills(userId);
      const categories = await projectSkillConfigStore.listByCategory(projectKey, skills);
      success(res, { categories });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list project skills";
      error(res, "LIST_PROJECT_SKILLS_FAILED", msg, 500);
    }
  });

  /**
   * Update project skill enabled status
   * PATCH /projects/:ownerType/:ownerKey/:projectKey/skills/:skillId
   */
  router.patch("/projects/:ownerType/:ownerKey/:projectKey/skills/:skillId", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const skillId = decodeURIComponent(req.params.skillId);
      const { enabled } = req.body as { enabled?: boolean };

      if (typeof enabled !== "boolean") {
        error(res, "INVALID_REQUEST", "enabled must be a boolean");
        return;
      }

      await agentSkillCatalog.initialize();
      await agentSkillCatalog.refreshPluginSkillsForUser(userId);
      const skill = agentSkillCatalog.getById(skillId, userId);
      if (!skill) {
        error(res, "NOT_FOUND", `Skill not found: ${skillId}`, 404);
        return;
      }

      const config = await projectSkillConfigStore.updateEnabled(projectKey, skill, enabled);
      success(res, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update project skill";
      error(res, "UPDATE_PROJECT_SKILL_FAILED", msg, 500);
    }
  });

  /**
   * Batch update project skill enabled status
   * PATCH /projects/:ownerType/:ownerKey/:projectKey/skills
   */
  router.patch("/projects/:ownerType/:ownerKey/:projectKey/skills", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      const { updates } = req.body as {
        updates?: Array<{ skillId: string; enabled: boolean }>;
      };

      if (!Array.isArray(updates)) {
        error(res, "INVALID_REQUEST", "updates must be an array");
        return;
      }

      await agentSkillCatalog.initialize();
      await agentSkillCatalog.refreshPluginSkillsForUser(userId);
      const allSkills = agentSkillCatalog.getAllSkills(userId);
      await projectSkillConfigStore.batchUpdateEnabled(projectKey, allSkills, updates);
      success(res, { success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to batch update project skills";
      error(res, "BATCH_UPDATE_PROJECT_SKILLS_FAILED", msg, 500);
    }
  });

  /**
   * Get enabled slash commands for a project
   * GET /projects/:ownerType/:ownerKey/:projectKey/skills/enabled-commands
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/skills/enabled-commands", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      await agentSkillCatalog.initialize();
      await agentSkillCatalog.refreshPluginSkillsForUser(userId);
      const allSkills = agentSkillCatalog.getAllSkills(userId);
      const enabledIds = new Set(
        await projectSkillConfigStore.getEnabledSkillIds(projectKey, allSkills),
      );

      const commands = allSkills
        .filter((skill) => enabledIds.has(skill.id) && typeof skill.command === "string")
        .map((skill) => {
          const fromMetadata = Boolean(skill.metadata && skill.metadata.requiresDocScope === true);
          const fromSchema = zodObjectHasRequiredKey(skill.inputSchema, "doc_id");
          return {
            skill_id: skill.id,
            command: skill.command as string,
            name: skill.displayName,
            description: skill.description,
            category: skill.category,
            source: skill.source,
            requires_doc_scope: fromMetadata || fromSchema,
          };
        })
        .sort((a, b) => a.command.localeCompare(b.command));
      success(res, { commands });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list enabled commands";
      error(res, "LIST_PROJECT_ENABLED_COMMANDS_FAILED", msg, 500);
    }
  });

  /**
   * Get enabled tool names for a project
   * GET /projects/:ownerType/:ownerKey/:projectKey/skills/enabled-tools
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/skills/enabled-tools", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      await agentSkillCatalog.initialize();
      await agentSkillCatalog.refreshPluginSkillsForUser(userId);
      const allSkills = agentSkillCatalog.getAllSkills(userId);
      const toolNames = await projectSkillConfigStore.getEnabledToolNames(projectKey, allSkills);
      success(res, { tool_names: toolNames });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list enabled tools";
      error(res, "LIST_ENABLED_TOOLS_FAILED", msg, 500);
    }
  });

  /**
   * Get skill source summary for a project
   * GET /projects/:ownerType/:ownerKey/:projectKey/skills/sources
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/skills/sources", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const userId = getUserId(req);
      await agentSkillCatalog.initialize();
      await agentSkillCatalog.refreshPluginSkillsForUser(userId);
      const allSkills = agentSkillCatalog.getAllSkills(userId);
      const sources = await projectSkillConfigStore.listSources(projectKey, allSkills);
      success(res, { sources });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list skill sources";
      error(res, "LIST_SKILL_SOURCES_FAILED", msg, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Chat Settings API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get chat settings
   * GET /settings/chat
   */
  router.get("/settings/chat", async (_req: Request, res: Response) => {
    try {
      const { chatSettingsStore } = await import("./services/chat-settings-store.js");
      const settings = await chatSettingsStore.get();
      success(res, settings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get chat settings";
      error(res, "GET_CHAT_SETTINGS_FAILED", msg, 500);
    }
  });

  /**
   * Update chat settings
   * PUT /settings/chat
   */
  router.put("/settings/chat", async (req: Request, res: Response) => {
    try {
      const { chatSettingsStore } = await import("./services/chat-settings-store.js");
      const { full_access } = req.body as { full_access?: boolean };

      const settings = await chatSettingsStore.update({
        fullAccess: full_access === true,
      });

      success(res, settings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update chat settings";
      error(res, "UPDATE_CHAT_SETTINGS_FAILED", msg, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Web Search Configuration API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get web search configuration
   * GET /settings/web-search
   */
  router.get("/settings/web-search", async (_req: Request, res: Response) => {
    try {
      const { webSearchConfigStore } = await import("./services/web-search-config.js");
      const config = await webSearchConfigStore.get();
      success(res, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get web search config";
      error(res, "GET_WEB_SEARCH_CONFIG_FAILED", msg, 500);
    }
  });

  /**
   * Set (upsert) web search configuration
   * PUT /settings/web-search
   */
  router.put("/settings/web-search", async (req: Request, res: Response) => {
    try {
      const { webSearchConfigStore } = await import("./services/web-search-config.js");
      const { provider, api_key, enabled } = req.body as {
        provider?: string;
        api_key?: string;
        enabled?: boolean;
      };

      if (!provider) {
        error(res, "INVALID_REQUEST", "provider is required");
        return;
      }

      if (!["tavily", "serpapi", "duckduckgo"].includes(provider)) {
        error(res, "INVALID_REQUEST", "provider must be 'tavily', 'serpapi', or 'duckduckgo'");
        return;
      }

      const config = await webSearchConfigStore.upsert({
        provider: provider as "tavily" | "serpapi" | "duckduckgo",
        apiKey: api_key,
        enabled,
      });

      success(res, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set web search config";
      error(res, "SET_WEB_SEARCH_CONFIG_FAILED", msg, 500);
    }
  });

  /**
   * Delete web search configuration
   * DELETE /settings/web-search
   */
  router.delete("/settings/web-search", async (_req: Request, res: Response) => {
    try {
      const { webSearchConfigStore } = await import("./services/web-search-config.js");
      const deleted = await webSearchConfigStore.delete();
      success(res, { deleted });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete web search config";
      error(res, "DELETE_WEB_SEARCH_CONFIG_FAILED", msg, 500);
    }
  });

  /**
   * Test web search
   * POST /settings/web-search/test
   */
  router.post("/settings/web-search/test", async (req: Request, res: Response) => {
    try {
      const { webSearch, isWebSearchAvailable } = await import("./services/web-search.js");

      const available = await isWebSearchAvailable();
      if (!available) {
        error(res, "NOT_CONFIGURED", "Web search is not configured or disabled");
        return;
      }

      const { query: testQuery } = req.body as { query?: string };
      const searchQuery = testQuery || "test search query";

      const results = await webSearch(searchQuery, { limit: 3 });
      success(res, { results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Web search test failed";
      error(res, "WEB_SEARCH_TEST_FAILED", msg, 500);
    }
  });

  // ===== Chat Attachments =====

  /**
   * Upload a chat attachment (file or URL)
   * POST /projects/:ownerType/:ownerKey/:projectKey/chat/attachments
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/chat/attachments",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const { url } = req.body as { url?: string };
        const file = req.file;

        // Handle URL attachment
        if (url && typeof url === "string") {
          const trimmedUrl = url.trim();
          if (!trimmedUrl) {
            error(res, "INVALID_URL", "URL is empty");
            return;
          }

          try {
            const userId = getUserId(req);
            const result = await fetchUrl(userId, projectKey, trimmedUrl);
            // Extract text content from HTML (simple extraction)
            const textContent = extractTextFromHtml(result.html);
            const truncatedContent = textContent.slice(0, 10000); // Limit content size

            success(res, {
              id: uuidv4(),
              type: "url",
              name: trimmedUrl,
              content: truncatedContent,
              originalUrl: result.url,
              fetchedAt: result.fetched_at,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to fetch URL";
            error(res, "FETCH_URL_FAILED", msg, 500);
          }
          return;
        }

        // Handle file attachment
        if (!file) {
          error(res, "NO_ATTACHMENT", "No file or URL provided");
          return;
        }

        const fileName = fixFilename(file.originalname);
        const mimeType = file.mimetype || "application/octet-stream";
        const isImage = mimeType.startsWith("image/");
        const isText = mimeType.startsWith("text/") || 
                       mimeType === "application/json" ||
                       mimeType === "application/xml";

        // Persist as asset so chat skills can reference it later (e.g. doc-smart-import).
        const userId = getUserId(req);
        const assetMeta = await assetStore.save(userId, projectKey, fileName, mimeType, file.buffer);

        let content = "";
        let preview: string | undefined;

        if (isText) {
          // Extract text content from text files
          content = file.buffer.toString("utf-8").slice(0, 10000);
        } else if (isImage) {
          // For images, create a base64 preview
          preview = `data:${mimeType};base64,${file.buffer.toString("base64")}`;
          content = `[Image: ${fileName}]`;
        } else {
          // For other files, just note the file type
          content = `[File: ${fileName} (${mimeType})]`;
        }

        success(res, {
          id: uuidv4(),
          type: isImage ? "image" : "file",
          name: fileName,
          asset_id: assetMeta.id,
          mimeType,
          size: file.size,
          content,
          preview,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Attachment upload failed";
        error(res, "ATTACHMENT_UPLOAD_FAILED", msg, 500);
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PPT Generation API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Export document to PPT
   * POST /projects/:ownerType/:ownerKey/:projectKey/documents/:docId/export-ppt
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/export-ppt",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);
        const { style, options } = req.body as {
          style?: {
            description?: string;
            templateId?: string;
            templateImages?: string[];
          };
          options?: {
            aspectRatio?: "16:9" | "4:3";
            language?: string;
          };
        };

        // Get the document
        const doc = await documentStore.get(userId, projectKey, docId);
        const body = doc.body?.content as JSONContent | undefined;

        if (!body || body.type !== "doc") {
          error(res, "INVALID_DOCUMENT", "Document has no valid Tiptap content");
          return;
        }

        // Dynamic import to avoid loading if not used
        const { pptService } = await import("./services/ppt/index.js");

        // Check if service is available
        const available = await pptService.isAvailable();
        if (!available) {
          error(res, "SERVICE_UNAVAILABLE", "PPT generation service is not available", 503);
          return;
        }

        // Generate PPT
        const result = await pptService.generateFromDocument(body, style, options);

        success(res, {
          task_id: result.taskId,
          status: result.status,
        }, 202);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          error(res, "NOT_FOUND", err.message, 404);
          return;
        }
        const msg = err instanceof Error ? err.message : "Failed to export PPT";
        error(res, "EXPORT_PPT_FAILED", msg, 500);
      }
    }
  );

  /**
   * Get PPT generation task status
   * GET /projects/:ownerType/:ownerKey/:projectKey/ppt-tasks/:taskId
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/ppt-tasks/:taskId",
    async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params;

        const { pptService } = await import("./services/ppt/index.js");
        const status = await pptService.getTaskStatus(taskId);

        success(res, {
          task_id: status.taskId,
          status: status.status,
          progress: status.progress,
          current_slide: status.currentSlide,
          total_slides: status.totalSlides,
          error: status.error,
          created_at: status.createdAt,
          updated_at: status.updatedAt,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to get task status";
        error(res, "GET_TASK_STATUS_FAILED", msg, 500);
      }
    }
  );

  /**
   * Download generated PPTX file
   * GET /projects/:ownerType/:ownerKey/:projectKey/ppt-tasks/:taskId/download
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/ppt-tasks/:taskId/download",
    async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params;

        const { pptService } = await import("./services/ppt/index.js");
        const buffer = await pptService.downloadPPTX(taskId);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        res.setHeader("Content-Disposition", `attachment; filename="presentation-${taskId}.pptx"`);
        res.send(buffer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to download PPTX";
        error(res, "DOWNLOAD_PPTX_FAILED", msg, 500);
      }
    }
  );

  /**
   * Get slide previews for a task
   * GET /projects/:ownerType/:ownerKey/:projectKey/ppt-tasks/:taskId/previews
   */
  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/ppt-tasks/:taskId/previews",
    async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params;

        const { pptService } = await import("./services/ppt/index.js");
        const previews = await pptService.getPreviews(taskId);

        success(res, { previews });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to get previews";
        error(res, "GET_PREVIEWS_FAILED", msg, 500);
      }
    }
  );

  /**
   * Modify a slide using natural language
   * POST /projects/:ownerType/:ownerKey/:projectKey/ppt-tasks/:taskId/modify
   */
  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/ppt-tasks/:taskId/modify",
    async (req: Request, res: Response) => {
      try {
        const { taskId } = req.params;
        const { slide_index, instruction } = req.body as {
          slide_index: number;
          instruction: string;
        };

        if (typeof slide_index !== "number" || !instruction) {
          error(res, "INVALID_REQUEST", "slide_index and instruction are required");
          return;
        }

        const { pptService } = await import("./services/ppt/index.js");
        const result = await pptService.modifySlide(taskId, slide_index, instruction);

        success(res, {
          task_id: result.taskId,
          status: result.status,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to modify slide";
        error(res, "MODIFY_SLIDE_FAILED", msg, 500);
      }
    }
  );

  /**
   * List available PPT templates (presets only)
   * GET /ppt-templates
   */
  router.get("/ppt-templates", async (_req: Request, res: Response) => {
    try {
      const { pptService } = await import("./services/ppt/index.js");
      const templates = pptService.getPresetTemplates();
      success(res, { templates });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list templates";
      error(res, "LIST_TEMPLATES_FAILED", msg, 500);
    }
  });

  /**
   * List all PPT templates for a project (presets + custom)
   * GET /projects/:ownerType/:ownerKey/:projectKey/ppt-templates
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/ppt-templates", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const { templateStore } = await import("./services/ppt/template-store.js");
      const templates = await templateStore.getAllTemplates(projectKey);
      success(res, templates);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to list templates";
      error(res, "LIST_TEMPLATES_FAILED", msg, 500);
    }
  });

  /**
   * Create a custom PPT template
   * POST /projects/:ownerType/:ownerKey/:projectKey/ppt-templates
   */
  router.post("/projects/:ownerType/:ownerKey/:projectKey/ppt-templates", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const { name, description, preview_url, template_images, color_scheme } = req.body as {
        name?: string;
        description?: string;
        preview_url?: string;
        template_images?: string[];
        color_scheme?: {
          primary?: string;
          secondary?: string;
          background?: string;
          text?: string;
          accent?: string;
        };
      };

      if (!name || typeof name !== "string" || !name.trim()) {
        error(res, "INVALID_REQUEST", "name is required");
        return;
      }

      const { templateStore } = await import("./services/ppt/template-store.js");
      const template = await templateStore.create(projectKey, {
        name: name.trim(),
        description,
        previewUrl: preview_url,
        templateImages: template_images,
        colorScheme: color_scheme,
      });

      success(res, template, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create template";
      error(res, "CREATE_TEMPLATE_FAILED", msg, 500);
    }
  });

  /**
   * Get a custom PPT template
   * GET /projects/:ownerType/:ownerKey/:projectKey/ppt-templates/:templateId
   */
  router.get("/projects/:ownerType/:ownerKey/:projectKey/ppt-templates/:templateId", async (req: Request, res: Response) => {
    try {
      const { projectKey, templateId } = req.params;
      const { templateStore } = await import("./services/ppt/template-store.js");
      const template = await templateStore.resolve(projectKey, templateId);

      if (!template) {
        error(res, "NOT_FOUND", "Template not found", 404);
        return;
      }

      success(res, template);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get template";
      error(res, "GET_TEMPLATE_FAILED", msg, 500);
    }
  });

  /**
   * Update a custom PPT template
   * PUT /projects/:ownerType/:ownerKey/:projectKey/ppt-templates/:templateId
   */
  router.put("/projects/:ownerType/:ownerKey/:projectKey/ppt-templates/:templateId", async (req: Request, res: Response) => {
    try {
      const { projectKey, templateId } = req.params;
      const { name, description, preview_url, template_images, color_scheme } = req.body as {
        name?: string;
        description?: string;
        preview_url?: string;
        template_images?: string[];
        color_scheme?: {
          primary?: string;
          secondary?: string;
          background?: string;
          text?: string;
          accent?: string;
        };
      };

      const { templateStore } = await import("./services/ppt/template-store.js");
      const template = await templateStore.update(projectKey, templateId, {
        name,
        description,
        previewUrl: preview_url,
        templateImages: template_images,
        colorScheme: color_scheme,
      });

      if (!template) {
        error(res, "NOT_FOUND", "Template not found", 404);
        return;
      }

      success(res, template);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update template";
      error(res, "UPDATE_TEMPLATE_FAILED", msg, 500);
    }
  });

  /**
   * Delete a custom PPT template
   * DELETE /projects/:ownerType/:ownerKey/:projectKey/ppt-templates/:templateId
   */
  router.delete("/projects/:ownerType/:ownerKey/:projectKey/ppt-templates/:templateId", async (req: Request, res: Response) => {
    try {
      const { projectKey, templateId } = req.params;
      const { templateStore } = await import("./services/ppt/template-store.js");
      const deleted = await templateStore.delete(projectKey, templateId);

      if (!deleted) {
        error(res, "NOT_FOUND", "Template not found", 404);
        return;
      }

      success(res, { deleted: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete template";
      error(res, "DELETE_TEMPLATE_FAILED", msg, 500);
    }
  });

  /**
   * Check PPT service availability
   * GET /ppt-service/status
   */
  router.get("/ppt-service/status", async (_req: Request, res: Response) => {
    try {
      const { pptService } = await import("./services/ppt/index.js");
      const available = await pptService.isAvailable();
      success(res, { available });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to check status";
      error(res, "CHECK_STATUS_FAILED", msg, 500);
    }
  });

  return router;
};

/**
 * Get default model for a provider (for testing)
 */
function getDefaultModelForProvider(providerId: LLMProviderId): string | null {
  switch (providerId) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-haiku-20241022";
    case "google":
      return "gemini-1.5-flash";
    case "openai-compatible":
      return null; // Must be configured
    default:
      return null;
  }
}
