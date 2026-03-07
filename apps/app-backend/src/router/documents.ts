import type { Request, Response, Router } from "express";

import { BlockNotFoundError, DocumentNotFoundError } from "../storage/document-store.js";

export function registerDocumentReadRoutes(input: {
  router: Router;
  documentStore: {
    getBlockById: (userId: string, projectKey: string, docId: string, blockId: string) => Promise<{ meta: unknown; body: unknown }>;
  };
  getUserId: (req: Request) => string;
  success: <T>(res: Response, data: T, status?: number) => void;
  localizedError: (res: Response, req: Request, code: string, fallbackMessage: string, status?: number) => Promise<void>;
}): void {
  const { router, documentStore, getUserId, success, localizedError } = input;

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
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        if (err instanceof BlockNotFoundError) {
          await localizedError(res, req, "BLOCK_NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Get block failed";
        await localizedError(res, req, "GET_BLOCK_FAILED", message, 500);
      }
    },
  );
}
