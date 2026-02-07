/**
 * Chat Session Store
 *
 * Manages chat sessions and messages in PostgreSQL.
 * Supports:
 *   - Session CRUD (list, create, get, delete, rename)
 *   - Message persistence (add, list)
 *   - LLM-powered title generation (fire-and-forget)
 */

import { v4 as uuidv4 } from "uuid";
import { query } from "../db/postgres.js";
import { configStore, llmGateway } from "../llm/index.js";

// ============================================================================
// Types
// ============================================================================

type ChatSessionRow = {
  id: string;
  user_id: string;
  project_key: string;
  title: string;
  created_at: Date;
  updated_at: Date;
};

type ChatMessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  sources: unknown | null;
  artifacts: unknown | null;
  created_at: Date;
};

export type ChatSession = {
  id: string;
  userId: string;
  projectKey: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageRecord = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  sources?: unknown;
  artifacts?: unknown;
  createdAt: string;
};

// ============================================================================
// Helpers
// ============================================================================

function mapSessionRow(row: ChatSessionRow): ChatSession {
  return {
    id: row.id,
    userId: row.user_id,
    projectKey: row.project_key,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapMessageRow(row: ChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    sources: row.sources ?? undefined,
    artifacts: row.artifacts ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

// ============================================================================
// Store
// ============================================================================

export const chatSessionStore = {
  // ──────────────── Sessions ────────────────

  /**
   * List sessions for a project, ordered by most recent first.
   */
  async listSessions(
    userId: string,
    projectKey: string,
    limit = 50,
    offset = 0,
  ): Promise<ChatSession[]> {
    const result = await query<ChatSessionRow>(
      `SELECT * FROM chat_sessions
       WHERE user_id = $1 AND project_key = $2
       ORDER BY updated_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, projectKey, limit, offset],
    );
    return result.rows.map(mapSessionRow);
  },

  /**
   * Create a new empty session.
   */
  async createSession(
    userId: string,
    projectKey: string,
    title = "新对话",
  ): Promise<ChatSession> {
    const id = uuidv4();
    const now = new Date();
    await query(
      `INSERT INTO chat_sessions (id, user_id, project_key, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, projectKey, title, now, now],
    );
    return {
      id,
      userId,
      projectKey,
      title,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  },

  /**
   * Get a session by ID (without messages).
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    const result = await query<ChatSessionRow>(
      `SELECT * FROM chat_sessions WHERE id = $1`,
      [sessionId],
    );
    if (result.rows.length === 0) return null;
    return mapSessionRow(result.rows[0]);
  },

  /**
   * Delete a session (messages cascade-deleted).
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM chat_sessions WHERE id = $1`,
      [sessionId],
    );
    return (result.rowCount ?? 0) > 0;
  },

  /**
   * Rename a session.
   */
  async renameSession(sessionId: string, title: string): Promise<ChatSession | null> {
    await query(
      `UPDATE chat_sessions SET title = $1, updated_at = now() WHERE id = $2`,
      [title, sessionId],
    );
    return this.getSession(sessionId);
  },

  /**
   * Touch updated_at timestamp.
   */
  async updateSessionTimestamp(sessionId: string): Promise<void> {
    await query(
      `UPDATE chat_sessions SET updated_at = now() WHERE id = $1`,
      [sessionId],
    );
  },

  // ──────────────── Messages ────────────────

  /**
   * List all messages for a session, ordered by creation time.
   */
  async getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
    const result = await query<ChatMessageRow>(
      `SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    return result.rows.map(mapMessageRow);
  },

  /**
   * Add a message to a session.
   */
  async addMessage(
    sessionId: string,
    role: string,
    content: string,
    sources?: unknown,
    artifacts?: unknown,
  ): Promise<ChatMessageRecord> {
    const id = uuidv4();
    const now = new Date();
    await query(
      `INSERT INTO chat_messages (id, session_id, role, content, sources, artifacts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        sessionId,
        role,
        content,
        sources ? JSON.stringify(sources) : null,
        artifacts ? JSON.stringify(artifacts) : null,
        now,
      ],
    );
    return {
      id,
      sessionId,
      role,
      content,
      sources,
      artifacts,
      createdAt: now.toISOString(),
    };
  },

  /**
   * Count messages in a session.
   */
  async getMessageCount(sessionId: string): Promise<number> {
    const result = await query<{ count: string }>(
      `SELECT count(*) AS count FROM chat_messages WHERE session_id = $1`,
      [sessionId],
    );
    return parseInt(result.rows[0]?.count ?? "0", 10);
  },

  // ──────────────── Title Generation ────────────────

  /**
   * Generate a session title from the first user message using LLM.
   * Fire-and-forget — errors are logged but never thrown.
   */
  generateTitle(sessionId: string, firstMessage: string): void {
    // Run async without awaiting
    (async () => {
      try {
        const llmConfig = await configStore.getInternalByType("llm");
        if (!llmConfig?.enabled || !llmConfig.defaultModel) {
          // Fallback: truncate first message
          const title = firstMessage.slice(0, 30).replace(/\n/g, " ").trim() || "新对话";
          await query(
            `UPDATE chat_sessions SET title = $1 WHERE id = $2 AND title = '新对话'`,
            [title, sessionId],
          );
          return;
        }

        const response = await llmGateway.chat({
          provider: llmConfig.providerId,
          model: llmConfig.defaultModel,
          baseUrl: llmConfig.baseUrl,
          apiKey: llmConfig.apiKey,
          messages: [
            {
              role: "system",
              content: "用10个字以内总结这段对话的主题，只输出标题文字，不要标点符号和引号。",
            },
            { role: "user", content: firstMessage },
          ],
          temperature: 0,
          maxTokens: 30,
        });

        const title = response.content.trim().replace(/["""'']/g, "").slice(0, 30) || "新对话";
        await query(
          `UPDATE chat_sessions SET title = $1 WHERE id = $2`,
          [title, sessionId],
        );
        console.log(`[chat-session] Generated title for ${sessionId}: ${title}`);
      } catch (err) {
        console.warn("[chat-session] Title generation failed:", err);
        // Fallback: truncate first message
        try {
          const title = firstMessage.slice(0, 30).replace(/\n/g, " ").trim() || "新对话";
          await query(
            `UPDATE chat_sessions SET title = $1 WHERE id = $2 AND title = '新对话'`,
            [title, sessionId],
          );
        } catch {
          // ignore
        }
      }
    })();
  },
};
