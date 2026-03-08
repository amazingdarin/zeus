import type { Request, Response, Router } from "express";

import { BlockNotFoundError, DocumentNotFoundError } from "../storage/document-store.js";
import type { ResolvedProjectScope } from "../middleware/project-scope.js";
import type { CommentThreadStatus, ProjectRole } from "../services/document-block-comment-model.js";
import {
  CommentMessageNotFoundError,
  CommentThreadNotFoundError,
} from "../services/document-block-comment-store.js";

export function registerDocumentCommentRoutes(input: {
  router: Router;
  documentStore: {
    get: (userId: string, projectKey: string, docId: string) => Promise<unknown>;
    getBlockById: (userId: string, projectKey: string, docId: string, blockId: string) => Promise<unknown>;
  };
  documentBlockCommentStore: {
    listThreads: (input: { userId: string; projectKey: string; docId: string; blockId?: string; status?: CommentThreadStatus; cursor?: string; limit?: number }) => Promise<unknown>;
    getThread: (input: { userId: string; projectKey: string; docId: string; threadId: string }) => Promise<unknown>;
    createThread: (input: { userId: string; projectKey: string; docId: string; blockId: string; content: string }) => Promise<unknown>;
    addMessage: (input: { userId: string; projectKey: string; docId: string; threadId: string; content: string }) => Promise<unknown>;
    setThreadStatus: (input: { userId: string; projectKey: string; docId: string; threadId: string; status: CommentThreadStatus }) => Promise<unknown>;
    findMessage: (input: { userId: string; projectKey: string; docId: string; messageId: string }) => Promise<{ message: { authorId: string } }>;
    deleteMessage: (input: { userId: string; projectKey: string; docId: string; messageId: string }) => Promise<void>;
  };
  getUserId: (req: Request) => string;
  success: <T>(res: Response, data: T, status?: number) => void;
  localizedError: (res: Response, req: Request, code: string, fallbackMessage: string, status?: number) => Promise<void>;
  parseCommentListQuery: (input: Record<string, unknown> | null | undefined) => { blockId?: string; status?: CommentThreadStatus; cursor?: string; limit: number };
  parseCommentContentInput: (input: unknown) => string;
  parseCommentStatusInput: (input: Record<string, unknown> | null | undefined) => CommentThreadStatus | null;
  resolveCommentActorRole: (scope: ResolvedProjectScope, userId: string) => Promise<ProjectRole>;
  canWriteComment: (role: ProjectRole) => boolean;
  canDeleteCommentMessage: (input: { actorId: string; authorId: string; role: ProjectRole }) => boolean;
}): void {
  const {
    router,
    documentStore,
    documentBlockCommentStore,
    getUserId,
    success,
    localizedError,
    parseCommentListQuery,
    parseCommentContentInput,
    parseCommentStatusInput,
    resolveCommentActorRole,
    canWriteComment,
    canDeleteCommentMessage,
  } = input;

  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);
        await documentStore.get(userId, projectKey, docId);
        const listQuery = parseCommentListQuery(req.query as unknown as Record<string, unknown>);
        const data = await documentBlockCommentStore.listThreads({
          userId,
          projectKey,
          docId,
          blockId: listQuery.blockId,
          status: listQuery.status,
          cursor: listQuery.cursor,
          limit: listQuery.limit,
        });
        success(res, data);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "List block comments failed";
        await localizedError(res, req, "LIST_BLOCK_COMMENTS_FAILED", message, 500);
      }
    },
  );

  router.get(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId, threadId } = req.params;
        const userId = getUserId(req);
        await documentStore.get(userId, projectKey, docId);
        const data = await documentBlockCommentStore.getThread({ userId, projectKey, docId, threadId });
        success(res, data);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        if (err instanceof CommentThreadNotFoundError) {
          await localizedError(res, req, err.code, err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Get block comment thread failed";
        await localizedError(res, req, "GET_BLOCK_COMMENT_THREAD_FAILED", message, 500);
      }
    },
  );

  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId } = req.params;
        const userId = getUserId(req);
        const scope = req.projectScope;
        if (!scope) {
          await localizedError(res, req, "PROJECT_SCOPE_REQUIRED", "project scope is required", 500);
          return;
        }
        const role = await resolveCommentActorRole(scope, userId);
        if (!canWriteComment(role)) {
          await localizedError(res, req, "COMMENT_PERMISSION_DENIED", "insufficient permission", 403);
          return;
        }
        const blockId = String(req.body?.blockId ?? "").trim();
        const content = parseCommentContentInput(req.body?.content);
        if (!blockId) {
          await localizedError(res, req, "BLOCK_ID_REQUIRED", "blockId is required", 400);
          return;
        }
        if (!content) {
          await localizedError(res, req, "COMMENT_CONTENT_REQUIRED", "content is required", 400);
          return;
        }
        await documentStore.getBlockById(userId, projectKey, docId, blockId);
        const created = await documentBlockCommentStore.createThread({ userId, projectKey, docId, blockId, content });
        success(res, created, 201);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        if (err instanceof BlockNotFoundError) {
          await localizedError(res, req, "BLOCK_NOT_FOUND", err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Create block comment thread failed";
        await localizedError(res, req, "CREATE_BLOCK_COMMENT_THREAD_FAILED", message, 500);
      }
    },
  );

  router.post(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId/messages",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId, threadId } = req.params;
        const userId = getUserId(req);
        const scope = req.projectScope;
        if (!scope) {
          await localizedError(res, req, "PROJECT_SCOPE_REQUIRED", "project scope is required", 500);
          return;
        }
        const role = await resolveCommentActorRole(scope, userId);
        if (!canWriteComment(role)) {
          await localizedError(res, req, "COMMENT_PERMISSION_DENIED", "insufficient permission", 403);
          return;
        }
        const content = parseCommentContentInput(req.body?.content);
        if (!content) {
          await localizedError(res, req, "COMMENT_CONTENT_REQUIRED", "content is required", 400);
          return;
        }
        await documentStore.get(userId, projectKey, docId);
        const messageRow = await documentBlockCommentStore.addMessage({ userId, projectKey, docId, threadId, content });
        success(res, messageRow, 201);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        if (err instanceof CommentThreadNotFoundError) {
          await localizedError(res, req, err.code, err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Create block comment message failed";
        await localizedError(res, req, "CREATE_BLOCK_COMMENT_MESSAGE_FAILED", message, 500);
      }
    },
  );

  router.patch(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/:threadId",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId, threadId } = req.params;
        const userId = getUserId(req);
        const scope = req.projectScope;
        if (!scope) {
          await localizedError(res, req, "PROJECT_SCOPE_REQUIRED", "project scope is required", 500);
          return;
        }
        const role = await resolveCommentActorRole(scope, userId);
        if (!canWriteComment(role)) {
          await localizedError(res, req, "COMMENT_PERMISSION_DENIED", "insufficient permission", 403);
          return;
        }
        const status = parseCommentStatusInput(req.body as Record<string, unknown> | undefined);
        if (!status) {
          await localizedError(res, req, "INVALID_COMMENT_STATUS", "status must be open or resolved", 400);
          return;
        }
        await documentStore.get(userId, projectKey, docId);
        const thread = await documentBlockCommentStore.setThreadStatus({ userId, projectKey, docId, threadId, status });
        success(res, thread);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        if (err instanceof CommentThreadNotFoundError) {
          await localizedError(res, req, err.code, err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Update block comment thread failed";
        await localizedError(res, req, "UPDATE_BLOCK_COMMENT_THREAD_FAILED", message, 500);
      }
    },
  );

  router.delete(
    "/projects/:ownerType/:ownerKey/:projectKey/documents/:docId/block-comments/messages/:messageId",
    async (req: Request, res: Response) => {
      try {
        const { projectKey, docId, messageId } = req.params;
        const userId = getUserId(req);
        const scope = req.projectScope;
        if (!scope) {
          await localizedError(res, req, "PROJECT_SCOPE_REQUIRED", "project scope is required", 500);
          return;
        }
        await documentStore.get(userId, projectKey, docId);
        const found = await documentBlockCommentStore.findMessage({ userId, projectKey, docId, messageId });
        const role = await resolveCommentActorRole(scope, userId);
        if (!canDeleteCommentMessage({ actorId: userId, authorId: found.message.authorId, role })) {
          await localizedError(res, req, "COMMENT_PERMISSION_DENIED", "insufficient permission", 403);
          return;
        }
        await documentBlockCommentStore.deleteMessage({ userId, projectKey, docId, messageId });
        success(res, { messageId });
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          await localizedError(res, req, "NOT_FOUND", err.message, 404);
          return;
        }
        if (err instanceof CommentMessageNotFoundError) {
          await localizedError(res, req, err.code, err.message, 404);
          return;
        }
        const message = err instanceof Error ? err.message : "Delete block comment message failed";
        await localizedError(res, req, "DELETE_BLOCK_COMMENT_MESSAGE_FAILED", message, 500);
      }
    },
  );
}
