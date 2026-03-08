import type { Request, Response, Router } from "express";

import { DocumentNotFoundError } from "../storage/document-store.js";
import type { Document, DocumentMeta } from "../storage/types.js";

export function registerDocumentLockRoutes(input: {
  router: Router;
  documentStore: {
    get: (userId: string, projectKey: string, docId: string) => Promise<Document>;
    save: (userId: string, projectKey: string, doc: Document) => Promise<Document>;
  };
  getUserId: (req: Request) => string;
  success: <T>(res: Response, data: T, status?: number) => void;
  error: (res: Response, code: string, message: string, status?: number) => void;
  localizedError: (res: Response, req: Request, code: string, fallbackMessage: string, status?: number) => Promise<void>;
  applyDocumentLock: (meta: DocumentMeta, userId: string, lockedAt: string) => { locked: true; lockedBy: string; lockedAt: string };
  clearDocumentLock: (meta: DocumentMeta) => void;
  getDocumentLockInfo: (meta: DocumentMeta) => { locked: true; lockedBy: string; lockedAt: string } | null;
}): void {
  const {
    router,
    documentStore,
    getUserId,
    success,
    error,
    localizedError,
    applyDocumentLock,
    clearDocumentLock,
    getDocumentLockInfo,
  } = input;

  router.put(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/lock",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);
        const doc = await documentStore.get(userId, projectKey, docId);
        const existingLock = getDocumentLockInfo(doc.meta);
        if (existingLock?.locked) {
          success(res, { lock: existingLock });
          return;
        }
        const lock = applyDocumentLock(doc.meta, userId, new Date().toISOString());
        const saved = await documentStore.save(userId, projectKey, doc as Document);
        success(res, { lock: getDocumentLockInfo(saved.meta) ?? lock });
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Lock failed";
        error(res, "LOCK_DOCUMENT_FAILED", message, 500);
      }
    },
  );

  router.delete(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/lock",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);
        const doc = await documentStore.get(userId, projectKey, docId);
        clearDocumentLock(doc.meta);
        const saved = await documentStore.save(userId, projectKey, doc as Document);
        success(res, { lock: getDocumentLockInfo(saved.meta) });
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Unlock failed";
        error(res, "UNLOCK_DOCUMENT_FAILED", message, 500);
      }
    },
  );
}
