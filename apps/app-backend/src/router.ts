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

const upload = multer({ storage: multer.memoryStorage() });

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
   * Delete a document
   * DELETE /projects/:projectKey/documents/:docId
   */
  router.delete("/projects/:projectKey/documents/:docId", async (req: Request, res: Response) => {
    try {
      const { projectKey, docId } = req.params;
      await documentStore.delete(projectKey, docId);

      // Remove from index asynchronously
      knowledgeSearch.removeDocument(projectKey, docId).catch((err) => {
        console.error("Remove index error:", err);
      });

      success(res, null);
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
   * Import file as document
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
        const sourceType = String(req.body?.source_type ?? "").trim().toLowerCase();
        const from = sourceType || file.originalname.split(".").pop() || "";
        const converted = await convertDocument(projectKey, file, from, "markdown");
        success(res, converted);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Import failed";
        error(res, "IMPORT_FAILED", message);
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

  return router;
};
