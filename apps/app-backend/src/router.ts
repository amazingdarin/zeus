import { Router, type Request, type Response } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";

import { convertDocument } from "./services/convert.js";
import { fetchUrl } from "./services/fetch-url.js";
import { importGit } from "./services/import-git.js";
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
import { createRun, getRun, streamRun, clearSession } from "./services/chat.js";
import {
  createTask as createOptimizeTask,
  getTask as getOptimizeTask,
  streamTask as streamOptimizeTask,
  type OptimizeMode,
} from "./services/optimize.js";

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
        body: body.body,
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
      const doc: Document = {
        meta: {
          ...existing.meta,
          ...body.meta,
          id: docId, // Ensure ID doesn't change
        },
        body: body.body || existing.body,
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
      const validProviders: LLMProviderId[] = ["openai", "anthropic", "google", "ollama", "openai-compatible"];
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
      
      // Test based on config type
      try {
        if (configType === "embedding") {
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
          // Test LLM chat
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
      const validProviders: LLMProviderId[] = ["openai", "anthropic", "google", "ollama", "openai-compatible"];
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
   * Check if vision OCR is available
   * GET /ocr/available
   */
  router.get("/ocr/available", async (_req: Request, res: Response) => {
    try {
      const { ocrService } = await import("./services/ocr.js");
      const available = await ocrService.isVisionAvailable();
      success(res, { available });
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
      const { session_id, message } = req.body as { session_id?: string; message?: string };

      if (!message || typeof message !== "string" || !message.trim()) {
        error(res, "INVALID_REQUEST", "message is required");
        return;
      }

      // Use provided session_id or generate one
      const sessionId = session_id || `session-${uuidv4()}`;

      const runId = await createRun(projectKey, sessionId, message.trim());

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

    try {
      const run = getRun(runId);
      if (!run) {
        res.write(`event: run.error\ndata: ${JSON.stringify({ error: "Run not found" })}\n\n`);
        res.end();
        return;
      }

      // Stream the response
      for await (const chunk of streamRun(runId)) {
        if (chunk.type === "delta") {
          res.write(`event: assistant.delta\ndata: ${JSON.stringify(chunk.content)}\n\n`);
        } else if (chunk.type === "done") {
          res.write(`event: assistant.done\ndata: ${JSON.stringify({
            message: chunk.message,
            sources: chunk.sources || [],
          })}\n\n`);
        } else if (chunk.type === "error") {
          res.write(`event: run.error\ndata: ${JSON.stringify({ error: chunk.error })}\n\n`);
        }
      }

      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stream failed";
      res.write(`event: run.error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
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
