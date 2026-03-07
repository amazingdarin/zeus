import { v4 as uuidv4 } from "uuid";

import { getClient, query } from "../db/postgres.js";
import { resolveProjectScope } from "../project-scope.js";
import {
  normalizeCommentThreadStatus,
  type CommentThreadStatus,
} from "./document-block-comment-model.js";

type ThreadRow = {
  id: string;
  owner_type: string;
  owner_id: string;
  project_key: string;
  doc_id: string;
  block_id: string;
  status: string;
  created_by: string;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  author_id: string;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
};

type ThreadWithMessageRow = MessageRow & {
  thread_id_ref: string;
  owner_type: string;
  owner_id: string;
  project_key: string;
  doc_id: string;
  block_id: string;
  status: string;
  created_by: string;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  thread_created_at: Date | string;
  thread_updated_at: Date | string;
};

export type DocumentBlockCommentThread = {
  id: string;
  ownerType: string;
  ownerId: string;
  projectKey: string;
  docId: string;
  blockId: string;
  status: CommentThreadStatus;
  createdBy: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentBlockCommentMessage = {
  id: string;
  threadId: string;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type DocumentBlockCommentThreadDetail = {
  thread: DocumentBlockCommentThread;
  messages: DocumentBlockCommentMessage[];
};

export type DocumentBlockCommentThreadListResult = {
  items: DocumentBlockCommentThreadDetail[];
  nextCursor?: string;
};

export class CommentThreadNotFoundError extends Error {
  readonly code = "THREAD_NOT_FOUND";

  constructor(threadId: string) {
    super(`Comment thread not found: ${threadId}`);
    this.name = "CommentThreadNotFoundError";
  }
}

export class CommentMessageNotFoundError extends Error {
  readonly code = "MESSAGE_NOT_FOUND";

  constructor(messageId: string) {
    super(`Comment message not found: ${messageId}`);
    this.name = "CommentMessageNotFoundError";
  }
}

let initPromise: Promise<void> | null = null;

function toIso(input: Date | string | null | undefined): string {
  if (!input) {
    return "";
  }
  if (input instanceof Date) {
    return input.toISOString();
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? String(input) : parsed.toISOString();
}

function normalizeContent(input: unknown): string {
  return String(input ?? "").trim();
}

function normalizeDocId(input: unknown): string {
  return String(input ?? "").trim();
}

function normalizeBlockId(input: unknown): string {
  return String(input ?? "").trim();
}

function normalizeLimit(input: unknown, fallback = 50): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function encodeThreadCursor(row: ThreadRow): string {
  return `${toIso(row.updated_at)}::${row.id}`;
}

function decodeThreadCursor(cursor: unknown): { updatedAt: string; id: string } | null {
  const raw = String(cursor ?? "").trim();
  if (!raw) {
    return null;
  }
  const index = raw.lastIndexOf("::");
  if (index <= 0 || index >= raw.length - 2) {
    return null;
  }
  const updatedAt = raw.slice(0, index).trim();
  const id = raw.slice(index + 2).trim();
  if (!updatedAt || !id) {
    return null;
  }
  return { updatedAt, id };
}

function mapThreadRow(row: ThreadRow): DocumentBlockCommentThread {
  const status = normalizeCommentThreadStatus(row.status) ?? "open";
  const resolvedBy = String(row.resolved_by ?? "").trim();
  const resolvedAt = toIso(row.resolved_at);
  return {
    id: String(row.id ?? ""),
    ownerType: String(row.owner_type ?? ""),
    ownerId: String(row.owner_id ?? ""),
    projectKey: String(row.project_key ?? ""),
    docId: String(row.doc_id ?? ""),
    blockId: String(row.block_id ?? ""),
    status,
    createdBy: String(row.created_by ?? ""),
    resolvedBy: resolvedBy || undefined,
    resolvedAt: resolvedAt || undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapMessageRow(row: MessageRow): DocumentBlockCommentMessage {
  const deletedAt = toIso(row.deleted_at);
  return {
    id: String(row.id ?? ""),
    threadId: String(row.thread_id ?? ""),
    authorId: String(row.author_id ?? ""),
    content: String(row.content ?? ""),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: deletedAt || undefined,
  };
}

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS document_block_comment_threads (
          id          TEXT PRIMARY KEY,
          owner_type  TEXT NOT NULL,
          owner_id    TEXT NOT NULL,
          project_key TEXT NOT NULL,
          doc_id      TEXT NOT NULL,
          block_id    TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'open',
          created_by  TEXT NOT NULL,
          resolved_by TEXT,
          resolved_at TIMESTAMPTZ,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS document_block_comment_messages (
          id         TEXT PRIMARY KEY,
          thread_id  TEXT NOT NULL REFERENCES document_block_comment_threads(id) ON DELETE CASCADE,
          author_id  TEXT NOT NULL,
          content    TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )
      `);

      await query(`
        CREATE INDEX IF NOT EXISTS idx_doc_block_comment_threads_scope_doc_status_updated
          ON document_block_comment_threads (owner_type, owner_id, project_key, doc_id, status, updated_at DESC)
      `);

      await query(`
        CREATE INDEX IF NOT EXISTS idx_doc_block_comment_threads_scope_doc_block_updated
          ON document_block_comment_threads (owner_type, owner_id, project_key, doc_id, block_id, updated_at DESC)
      `);

      await query(`
        CREATE INDEX IF NOT EXISTS idx_doc_block_comment_messages_thread_created
          ON document_block_comment_messages (thread_id, created_at ASC)
      `);
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  await initPromise;
}

async function loadMessagesByThreadIds(threadIds: string[]): Promise<Map<string, DocumentBlockCommentMessage[]>> {
  const result = new Map<string, DocumentBlockCommentMessage[]>();
  if (threadIds.length === 0) {
    return result;
  }
  const rows = await query<MessageRow>(
    `SELECT id, thread_id, author_id, content, created_at, updated_at, deleted_at
       FROM document_block_comment_messages
      WHERE thread_id = ANY($1::text[])
        AND deleted_at IS NULL
      ORDER BY created_at ASC`,
    [threadIds],
  );
  for (const row of rows.rows) {
    const message = mapMessageRow(row);
    if (!result.has(message.threadId)) {
      result.set(message.threadId, []);
    }
    result.get(message.threadId)?.push(message);
  }
  return result;
}

async function getThreadRowByScope(input: {
  ownerType: string;
  ownerId: string;
  projectKey: string;
  docId: string;
  threadId: string;
}): Promise<ThreadRow | null> {
  const threadResult = await query<ThreadRow>(
    `SELECT id, owner_type, owner_id, project_key, doc_id, block_id, status, created_by, resolved_by, resolved_at, created_at, updated_at
       FROM document_block_comment_threads
      WHERE owner_type = $1
        AND owner_id = $2
        AND project_key = $3
        AND doc_id = $4
        AND id = $5
      LIMIT 1`,
    [input.ownerType, input.ownerId, input.projectKey, input.docId, input.threadId],
  );
  return threadResult.rows[0] ?? null;
}

export const documentBlockCommentStore = {
  async createThread(input: {
    userId: string;
    projectKey: string;
    docId: string;
    blockId: string;
    content: string;
  }): Promise<DocumentBlockCommentThreadDetail> {
    await ensureInitialized();
    const scope = resolveProjectScope(input.userId, input.projectKey);
    const docId = normalizeDocId(input.docId);
    const blockId = normalizeBlockId(input.blockId);
    const content = normalizeContent(input.content);
    const createdBy = normalizeContent(input.userId);
    if (!docId || !blockId || !content || !createdBy) {
      throw new Error("docId, blockId, content and userId are required");
    }

    const threadId = uuidv4();
    const messageId = uuidv4();
    const client = await getClient();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO document_block_comment_threads (
           id, owner_type, owner_id, project_key, doc_id, block_id, status, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)`,
        [threadId, scope.ownerType, scope.ownerId, scope.projectKey, docId, blockId, createdBy],
      );
      await client.query(
        `INSERT INTO document_block_comment_messages (
           id, thread_id, author_id, content
         ) VALUES ($1, $2, $3, $4)`,
        [messageId, threadId, createdBy, content],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.getThread({
      userId: input.userId,
      projectKey: input.projectKey,
      docId,
      threadId,
    });
  },

  async listThreads(input: {
    userId: string;
    projectKey: string;
    docId: string;
    blockId?: string;
    status?: CommentThreadStatus;
    cursor?: string;
    limit?: number;
  }): Promise<DocumentBlockCommentThreadListResult> {
    await ensureInitialized();
    const scope = resolveProjectScope(input.userId, input.projectKey);
    const docId = normalizeDocId(input.docId);
    if (!docId) {
      throw new Error("docId is required");
    }

    const filters: string[] = [
      "owner_type = $1",
      "owner_id = $2",
      "project_key = $3",
      "doc_id = $4",
    ];
    const params: unknown[] = [scope.ownerType, scope.ownerId, scope.projectKey, docId];
    let cursorId: string | null = null;
    let cursorUpdatedAt: string | null = null;

    const blockId = normalizeBlockId(input.blockId);
    if (blockId) {
      params.push(blockId);
      filters.push(`block_id = $${params.length}`);
    }

    const status = normalizeCommentThreadStatus(input.status);
    if (status) {
      params.push(status);
      filters.push(`status = $${params.length}`);
    }

    const cursor = decodeThreadCursor(input.cursor);
    if (cursor) {
      cursorUpdatedAt = cursor.updatedAt;
      cursorId = cursor.id;
      params.push(cursorUpdatedAt);
      filters.push(`updated_at <= $${params.length}::timestamptz`);
      params.push(cursorId);
      filters.push(`(updated_at < $${params.length - 1}::timestamptz OR (updated_at = $${params.length - 1}::timestamptz AND id < $${params.length}))`);
    }

    const limit = normalizeLimit(input.limit, 50);
    params.push(limit + 1);

    const sql = `
      SELECT id, owner_type, owner_id, project_key, doc_id, block_id, status, created_by, resolved_by, resolved_at, created_at, updated_at
        FROM document_block_comment_threads
       WHERE ${filters.join(" AND ")}
       ORDER BY updated_at DESC, id DESC
       LIMIT $${params.length}
    `;
    const rows = await query<ThreadRow>(sql, params);
    const hasMore = rows.rows.length > limit;
    const pageRows = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const threadIds = pageRows.map((row) => row.id);
    const messagesByThreadId = await loadMessagesByThreadIds(threadIds);

    const items: DocumentBlockCommentThreadDetail[] = pageRows.map((row) => ({
      thread: mapThreadRow(row),
      messages: messagesByThreadId.get(row.id) ?? [],
    }));

    return {
      items,
      nextCursor: hasMore ? encodeThreadCursor(pageRows[pageRows.length - 1]) : undefined,
    };
  },

  async getThread(input: {
    userId: string;
    projectKey: string;
    docId: string;
    threadId: string;
  }): Promise<DocumentBlockCommentThreadDetail> {
    await ensureInitialized();
    const scope = resolveProjectScope(input.userId, input.projectKey);
    const docId = normalizeDocId(input.docId);
    const threadId = normalizeContent(input.threadId);
    if (!docId || !threadId) {
      throw new CommentThreadNotFoundError(threadId);
    }
    const row = await getThreadRowByScope({
      ownerType: scope.ownerType,
      ownerId: scope.ownerId,
      projectKey: scope.projectKey,
      docId,
      threadId,
    });
    if (!row) {
      throw new CommentThreadNotFoundError(threadId);
    }

    const messagesByThreadId = await loadMessagesByThreadIds([row.id]);
    return {
      thread: mapThreadRow(row),
      messages: messagesByThreadId.get(row.id) ?? [],
    };
  },

  async addMessage(input: {
    userId: string;
    projectKey: string;
    docId: string;
    threadId: string;
    content: string;
  }): Promise<DocumentBlockCommentMessage> {
    await ensureInitialized();
    const scope = resolveProjectScope(input.userId, input.projectKey);
    const docId = normalizeDocId(input.docId);
    const threadId = normalizeContent(input.threadId);
    const content = normalizeContent(input.content);
    const authorId = normalizeContent(input.userId);
    if (!docId || !threadId || !content || !authorId) {
      throw new Error("docId, threadId, content and userId are required");
    }

    const thread = await getThreadRowByScope({
      ownerType: scope.ownerType,
      ownerId: scope.ownerId,
      projectKey: scope.projectKey,
      docId,
      threadId,
    });
    if (!thread) {
      throw new CommentThreadNotFoundError(threadId);
    }

    const id = uuidv4();
    const messageResult = await query<MessageRow>(
      `INSERT INTO document_block_comment_messages (
         id, thread_id, author_id, content
       ) VALUES ($1, $2, $3, $4)
       RETURNING id, thread_id, author_id, content, created_at, updated_at, deleted_at`,
      [id, thread.id, authorId, content],
    );
    await query(
      `UPDATE document_block_comment_threads
          SET updated_at = now()
        WHERE id = $1`,
      [thread.id],
    );
    return mapMessageRow(messageResult.rows[0]);
  },

  async setThreadStatus(input: {
    userId: string;
    projectKey: string;
    docId: string;
    threadId: string;
    status: CommentThreadStatus;
  }): Promise<DocumentBlockCommentThread> {
    await ensureInitialized();
    const scope = resolveProjectScope(input.userId, input.projectKey);
    const docId = normalizeDocId(input.docId);
    const threadId = normalizeContent(input.threadId);
    const status = normalizeCommentThreadStatus(input.status);
    if (!docId || !threadId || !status) {
      throw new Error("docId, threadId and status are required");
    }
    const resolvedBy = status === "resolved" ? normalizeContent(input.userId) : null;
    const resolvedAt = status === "resolved" ? new Date().toISOString() : null;

    const result = await query<ThreadRow>(
      `UPDATE document_block_comment_threads
          SET status = $1,
              resolved_by = $2,
              resolved_at = $3::timestamptz,
              updated_at = now()
        WHERE owner_type = $4
          AND owner_id = $5
          AND project_key = $6
          AND doc_id = $7
          AND id = $8
        RETURNING id, owner_type, owner_id, project_key, doc_id, block_id, status, created_by, resolved_by, resolved_at, created_at, updated_at`,
      [
        status,
        resolvedBy,
        resolvedAt,
        scope.ownerType,
        scope.ownerId,
        scope.projectKey,
        docId,
        threadId,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new CommentThreadNotFoundError(threadId);
    }
    return mapThreadRow(row);
  },

  async findMessage(input: {
    userId: string;
    projectKey: string;
    docId: string;
    messageId: string;
  }): Promise<{ message: DocumentBlockCommentMessage; thread: DocumentBlockCommentThread }> {
    await ensureInitialized();
    const scope = resolveProjectScope(input.userId, input.projectKey);
    const docId = normalizeDocId(input.docId);
    const messageId = normalizeContent(input.messageId);
    if (!docId || !messageId) {
      throw new CommentMessageNotFoundError(messageId);
    }

    const result = await query<ThreadWithMessageRow>(
      `SELECT m.id,
              m.thread_id,
              m.author_id,
              m.content,
              m.created_at,
              m.updated_at,
              m.deleted_at,
              t.id AS thread_id_ref,
              t.owner_type,
              t.owner_id,
              t.project_key,
              t.doc_id,
              t.block_id,
              t.status,
              t.created_by,
              t.resolved_by,
              t.resolved_at,
              t.created_at AS thread_created_at,
              t.updated_at AS thread_updated_at
         FROM document_block_comment_messages m
         JOIN document_block_comment_threads t
           ON t.id = m.thread_id
        WHERE m.id = $1
          AND m.deleted_at IS NULL
          AND t.owner_type = $2
          AND t.owner_id = $3
          AND t.project_key = $4
          AND t.doc_id = $5
        LIMIT 1`,
      [messageId, scope.ownerType, scope.ownerId, scope.projectKey, docId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new CommentMessageNotFoundError(messageId);
    }

    const thread = mapThreadRow({
      id: row.thread_id_ref,
      owner_type: row.owner_type,
      owner_id: row.owner_id,
      project_key: row.project_key,
      doc_id: row.doc_id,
      block_id: row.block_id,
      status: row.status,
      created_by: row.created_by,
      resolved_by: row.resolved_by,
      resolved_at: row.resolved_at,
      created_at: row.thread_created_at,
      updated_at: row.thread_updated_at,
    });

    return {
      message: mapMessageRow(row),
      thread,
    };
  },

  async deleteMessage(input: {
    userId: string;
    projectKey: string;
    docId: string;
    messageId: string;
  }): Promise<void> {
    await ensureInitialized();
    const scope = resolveProjectScope(input.userId, input.projectKey);
    const docId = normalizeDocId(input.docId);
    const messageId = normalizeContent(input.messageId);
    if (!docId || !messageId) {
      throw new CommentMessageNotFoundError(messageId);
    }

    const result = await query<{ id: string }>(
      `UPDATE document_block_comment_messages m
          SET deleted_at = now(),
              updated_at = now()
         FROM document_block_comment_threads t
        WHERE m.id = $1
          AND t.id = m.thread_id
          AND t.owner_type = $2
          AND t.owner_id = $3
          AND t.project_key = $4
          AND t.doc_id = $5
          AND m.deleted_at IS NULL
      RETURNING m.id`,
      [messageId, scope.ownerType, scope.ownerId, scope.projectKey, docId],
    );
    if (!result.rows[0]) {
      throw new CommentMessageNotFoundError(messageId);
    }
  },
};
