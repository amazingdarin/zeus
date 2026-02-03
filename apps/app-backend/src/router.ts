import { Router, type Request, type Response } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import type { JSONContent } from "@tiptap/core";

import { convertDocument } from "./services/convert.js";
import { fetchUrl } from "./services/fetch-url.js";
import { importGit } from "./services/import-git.js";
import { ensureBlockIds } from "./utils/block-id.js";
import {
  documentStore,
  DocumentNotFoundError,
  BlockNotFoundError,
} from "./storage/document-store.js";
import type { Document, CreateDocumentRequest, MoveDocumentRequest, SearchQuery } from "./storage/types.js";
import { knowledgeSearch } from "./knowledge/search.js";
import { rebuildTaskManager } from "./knowledge/rebuild-task.js";
import { assetStore } from "./storage/asset-store.js";
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
import { createRun, getRun, streamRun, clearSession, cancelRun, confirmTool, rejectTool } from "./services/chat.js";
import { draftService } from "./services/draft.js";
import {
  createTask as createOptimizeTask,
  getTask as getOptimizeTask,
  streamTask as streamOptimizeTask,
  optimizeFormatSync,
  type OptimizeMode,
} from "./services/optimize.js";
import { skillConfigStore } from "./llm/skills/skill-config-store.js";

const upload = multer({ storage: multer.memoryStorage() });

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

export const buildRouter = () => {
  const router = Router();

  // ============================================
  // Document CRUD APIs
  // ============================================

  /**
   * List documents under a parent
   * GET /projects/:projectKey/documents?parent_id=xxx
   */
  router.get("/projects/:projectKey/documents", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const parentId = String(req.query.parent_id ?? "");
      const items = await documentStore.getChildren(projectKey, parentId);
      success(res, items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "List failed";
      error(res, "LIST_FAILED", message, 500);
    }
  });

  /**
   * Get the full document tree (all documents with nested children)
   * GET /projects/:projectKey/documents/tree
   */
  router.get("/projects/:projectKey/documents/tree", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const tree = await documentStore.getFullTree(projectKey);
      success(res, tree);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Get tree failed";
      error(res, "TREE_FAILED", message, 500);
    }
  });

  /**
   * Suggest documents matching a query (for @ mention autocomplete)
   * GET /projects/:projectKey/documents/suggest?q=xxx&limit=10&parentId=xxx
   * @param parentId - Optional: Only search children of this parent ("root" or "" for root level)
   */
  router.get("/projects/:projectKey/documents/suggest", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const query = String(req.query.q || "");
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 10), 50);
      // parentId: undefined = search all, "root" or "" = root level only, other = children of that doc
      const parentId = req.query.parentId !== undefined ? String(req.query.parentId) : undefined;

      const suggestions = await documentStore.suggest(projectKey, query, limit, parentId);
      success(res, suggestions);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Suggest failed";
      error(res, "SUGGEST_FAILED", message, 500);
    }
  });

  /**
   * Get a document by ID
   * GET /projects/:projectKey/documents/:docId
   */
  router.get("/projects/:projectKey/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      const doc = await documentStore.get(projectKey, docId);
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
   * GET /projects/:projectKey/documents/:docId/hierarchy
   */
  router.get(
    "/projects/:projectKey/documents/:docId/hierarchy",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const chain = await documentStore.getHierarchy(projectKey, docId);
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
   * GET /projects/:projectKey/documents/:docId/blocks/:blockId
   */
  router.get(
    "/projects/:projectKey/documents/:docId/blocks/:blockId",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId, blockId } = req.params;
        const doc = await documentStore.getBlockById(projectKey, docId, blockId);
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
   * POST /projects/:projectKey/documents
   */
  router.post("/projects/:projectKey/documents", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const body = req.body as CreateDocumentRequest;

      if (!body.meta?.title) {
        error(res, "MISSING_TITLE", "title is required");
        return;
      }

      const doc: Document = {
        meta: {
          id: body.meta.id || uuidv4(),
          schema_version: body.meta.schema_version || "v1",
          title: body.meta.title,
          slug: body.meta.slug || "",
          path: "",
          parent_id: body.meta.parent_id || "root",
          created_at: "",
          updated_at: "",
          extra: body.meta.extra,
        },
        body: {
          ...body.body,
          content: body.body?.content ? ensureBlockIds(body.body.content as JSONContent) : body.body?.content,
        },
      };

      const saved = await documentStore.save(projectKey, doc);

      // Index the document asynchronously
      knowledgeSearch.indexDocument(projectKey, saved).catch((err) => {
        console.error("Index error:", err);
      });

      success(res, { meta: saved.meta, body: saved.body }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Create failed";
      error(res, "CREATE_FAILED", message, 500);
    }
  });

  /**
   * Update an existing document
   * PUT /projects/:projectKey/documents/:docId
   */
  router.put("/projects/:projectKey/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      const body = req.body as CreateDocumentRequest;

      // Get existing document
      const existing = await documentStore.get(projectKey, docId);

      // Merge updates
      const updatedBody = body.body || existing.body;
      const doc: Document = {
        meta: {
          ...existing.meta,
          ...body.meta,
          id: docId, // Ensure ID doesn't change
        },
        body: {
          ...updatedBody,
          content: updatedBody?.content ? ensureBlockIds(updatedBody.content as JSONContent) : updatedBody?.content,
        },
      };

      const saved = await documentStore.save(projectKey, doc);

      // Re-index the document asynchronously
      knowledgeSearch.indexDocument(projectKey, saved).catch((err) => {
        console.error("Index error:", err);
      });

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
   * DELETE /projects/:projectKey/documents/:docId?recursive=true
   */
  router.delete("/projects/:projectKey/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      const recursive = req.query.recursive === "true";
      
      const deletedIds = await documentStore.delete(projectKey, docId, recursive);

      // Remove all deleted documents from index asynchronously
      for (const deletedId of deletedIds) {
        knowledgeSearch.removeDocument(projectKey, deletedId).catch((err) => {
          console.error("Remove index error:", err);
        });
      }

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
   * Move a document to a new parent
   * PATCH /projects/:projectKey/documents/:docId/move
   */
  router.patch(
    "/projects/:projectKey/documents/:docId/move",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const body = req.body as MoveDocumentRequest;

        await documentStore.move(
          projectKey,
          docId,
          body.target_parent_id,
          body.before_doc_id,
          body.after_doc_id,
        );

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
   * POST /projects/:projectKey/documents/:docId/optimize
   */
  router.post(
    "/projects/:projectKey/documents/:docId/optimize",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const body = req.body as { mode?: OptimizeMode; preserveStructure?: boolean; language?: string };

        const mode: OptimizeMode = body.mode || "full";
        if (!["format", "content", "full"].includes(mode)) {
          error(res, "INVALID_MODE", "mode must be 'format', 'content', or 'full'");
          return;
        }

        const taskId = await createOptimizeTask(projectKey, docId, {
          mode,
          preserveStructure: body.preserveStructure,
          language: body.language,
        });

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
   * GET /projects/:projectKey/documents/:docId/optimize/:taskId/stream
   */
  router.get(
    "/projects/:projectKey/documents/:docId/optimize/:taskId/stream",
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
   * GET /projects/:projectKey/documents/:docId/optimize/:taskId
   */
  router.get(
    "/projects/:projectKey/documents/:docId/optimize/:taskId",
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
   * POST /projects/:projectKey/convert
   */
  router.post(
    "/projects/:projectKey/convert",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const from = String(req.query.from ?? "");
        const to = String(req.query.to ?? "");
        if (!req.file) {
          error(res, "INVALID_REQUEST", "file is required");
          return;
        }
        const result = await convertDocument(projectKey, req.file, from, to);
        success(res, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Convert failed";
        error(res, "CONVERT_FAILED", message);
      }
    },
  );

  /**
   * Fetch URL content
   * POST /projects/:projectKey/documents/fetch-url
   */
  router.post("/projects/:projectKey/documents/fetch-url", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const url = String(req.body?.url ?? "");
      const result = await fetchUrl(projectKey, url);
      success(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fetch failed";
      error(res, "FETCH_FAILED", message);
    }
  });

  /**
   * Import from Git repository
   * POST /projects/:projectKey/documents/import-git
   */
  router.post(
    "/projects/:projectKey/documents/import-git",
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const result = await importGit(projectKey, req.body ?? {});
        success(res, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed";
        error(res, "IMPORT_FAILED", message);
      }
    },
  );

  /**
   * Upload file as document (creates a document directly)
   * POST /projects/:projectKey/documents/upload
   */
  router.post(
    "/projects/:projectKey/documents/upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const file = req.file;
        if (!file) {
          error(res, "INVALID_REQUEST", "file is required");
          return;
        }
        const parentId = String(req.query.parent_id ?? "root");
        const filename = fixFilename(file.originalname);
        const sourceType = String(req.body?.source_type ?? "").trim().toLowerCase();
        const from = sourceType || filename.split(".").pop() || "";
        
        // Convert the file to markdown
        const converted = await convertDocument(projectKey, file, from, "markdown");
        
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
        
        const saved = await documentStore.save(projectKey, doc);
        
        // Index the document asynchronously
        knowledgeSearch.indexDocument(projectKey, saved).catch((err) => {
          console.error("Index error:", err);
        });
        
        success(res, { meta: saved.meta, body: saved.body }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        error(res, "UPLOAD_FAILED", message);
      }
    },
  );

  /**
   * Import file as document (returns converted content without saving)
   * POST /projects/:projectKey/documents/import
   */
  router.post(
    "/projects/:projectKey/documents/import",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const file = req.file;
        if (!file) {
          error(res, "INVALID_REQUEST", "file is required");
          return;
        }
        const filename = fixFilename(file.originalname);
        const sourceType = String(req.body?.source_type ?? "").trim().toLowerCase();
        const from = sourceType || filename.split(".").pop() || "";
        const converted = await convertDocument(projectKey, file, from, "markdown");
        success(res, converted);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed";
        error(res, "IMPORT_FAILED", message);
      }
    },
  );

  /**
   * Optimize markdown format using LLM
   * POST /projects/:projectKey/documents/optimize-format
   * Body: { markdown: string }
   * 
   * This is a fail-safe endpoint: if optimization fails, returns original markdown.
   */
  router.post(
    "/projects/:projectKey/documents/optimize-format",
    async (req: Request, res: Response) => {
      try {
        const markdown = String(req.body?.markdown ?? "");
        if (!markdown.trim()) {
          error(res, "INVALID_REQUEST", "markdown is required");
          return;
        }

        const optimized = await optimizeFormatSync(markdown);
        success(res, { 
          markdown: optimized,
          optimized: optimized !== markdown,
        });
      } catch (err) {
        // This should not happen as optimizeFormatSync is fail-safe
        const message = err instanceof Error ? err.message : "Optimization failed";
        error(res, "OPTIMIZE_FAILED", message);
      }
    },
  );

  // ============================================
  // Asset APIs
  // ============================================

  /**
   * Upload an asset (image, file, etc.)
   * POST /projects/:projectKey/assets/import
   */
  router.post(
    "/projects/:projectKey/assets/import",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const { projectKey } = req.params;
        const file = req.file;
        if (!file) {
          error(res, "INVALID_REQUEST", "file is required");
          return;
        }
        
        const filename = fixFilename(file.originalname);
        const meta = await assetStore.save(
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
   * GET /projects/:projectKey/assets/:assetId/content
   */
  router.get(
    "/projects/:projectKey/assets/:assetId/content",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, assetId } = req.params;
        const result = await assetStore.getContent(projectKey, assetId);
        
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
   * GET /projects/:projectKey/assets/:assetId/kind
   */
  router.get(
    "/projects/:projectKey/assets/:assetId/kind",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, assetId } = req.params;
        const meta = await assetStore.getMeta(projectKey, assetId);
        
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
   * POST /projects/:projectKey/knowledge/search
   */
  router.post("/projects/:projectKey/knowledge/search", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const query = req.body as SearchQuery;
      const results = await knowledgeSearch.search(projectKey, projectKey, query);
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
   * POST /projects/:projectKey/rag/rebuild
   * Returns task ID for progress tracking
   */
  router.post("/projects/:projectKey/rag/rebuild", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      
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
      const documents = await documentStore.getAllDocuments(projectKey);
      
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
          await knowledgeSearch.rebuildAll(projectKey, documents, (progress) => {
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
   * GET /projects/:projectKey/rag/rebuild/status
   */
  router.get("/projects/:projectKey/rag/rebuild/status", async (req: Request, res: Response) => {
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
   * POST /projects/:projectKey/rag/rebuild/documents/:docId
   */
  router.post("/projects/:projectKey/rag/rebuild/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      
      // Get the document
      const doc = await documentStore.get(projectKey, docId);
      
      // Rebuild its index
      await knowledgeSearch.rebuildDocument(projectKey, doc);
      
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
   * POST /projects/:projectKey/chat/runs
   */
  router.post("/projects/:projectKey/chat/runs", async (req: Request, res: Response) => {
    try {
      const { projectKey } = req.params;
      const { session_id, message, document_scope, deep_search } = req.body as { 
        session_id?: string; 
        message?: string;
        document_scope?: Array<{ doc_id: string; include_children: boolean }>;
        deep_search?: boolean;
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

      const runId = await createRun(projectKey, sessionId, message.trim(), docScope, {
        deepSearch: deep_search === true,
      });

      success(res, { run_id: runId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create chat run";
      error(res, "CREATE_RUN_FAILED", msg, 500);
    }
  });

  /**
   * Stream a chat run response (SSE)
   * GET /projects/:projectKey/chat/runs/:runId/stream
   */
  router.get("/projects/:projectKey/chat/runs/:runId/stream", async (req: Request, res: Response) => {
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
          res.write(`event: assistant.thinking\ndata: ${JSON.stringify({
            content: chunk.content,
            phase: chunk.phase,
            subQueries: chunk.subQueries,
          })}\n\n`);
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
   * DELETE /projects/:projectKey/chat/runs/:runId
   */
  router.delete("/projects/:projectKey/chat/runs/:runId", async (req: Request, res: Response) => {
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
   * POST /projects/:projectKey/chat/runs/:runId/confirm-tool
   */
  router.post("/projects/:projectKey/chat/runs/:runId/confirm-tool", async (req: Request, res: Response) => {
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
   * POST /projects/:projectKey/chat/runs/:runId/reject-tool
   */
  router.post("/projects/:projectKey/chat/runs/:runId/reject-tool", async (req: Request, res: Response) => {
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
   * Clear chat session history
   * DELETE /projects/:projectKey/chat/sessions/:sessionId
   */
  router.delete("/projects/:projectKey/chat/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      clearSession(sessionId);
      success(res, { cleared: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to clear session";
      error(res, "CLEAR_SESSION_FAILED", msg, 500);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Draft API (for AI-generated document changes)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get a draft by ID
   * GET /projects/:projectKey/drafts/:draftId
   */
  router.get("/projects/:projectKey/drafts/:draftId", async (req: Request, res: Response) => {
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
   * POST /projects/:projectKey/drafts/:draftId/apply
   */
  router.post("/projects/:projectKey/drafts/:draftId/apply", async (req: Request, res: Response) => {
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
   * DELETE /projects/:projectKey/drafts/:draftId
   */
  router.delete("/projects/:projectKey/drafts/:draftId", async (req: Request, res: Response) => {
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
   * GET /projects/:projectKey/drafts
   */
  router.get("/projects/:projectKey/drafts", async (req: Request, res: Response) => {
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
  router.get("/skills/enabled-commands", async (_req: Request, res: Response) => {
    try {
      const commands = await skillConfigStore.getEnabledCommands();
      success(res, { commands });
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
