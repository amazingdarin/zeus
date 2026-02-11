/**
 * Chat Sessions API Client
 */

import { apiFetch, encodeProjectRef } from "../config/api";
import type { SourceReference, ChatArtifact } from "../hooks/useChatLogic";

export type ChatSessionInfo = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageInfo = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SourceReference[];
  artifacts?: ChatArtifact[];
  createdAt: string;
};

/**
 * List chat sessions for a project (most recent first)
 */
export async function listSessions(
  projectKey: string,
  limit = 50,
  offset = 0,
): Promise<ChatSessionInfo[]> {
  const res = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/sessions?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error("Failed to list sessions");
  const json = await res.json();
  return json.data?.sessions ?? [];
}

/**
 * Create a new chat session
 */
export async function createSession(
  projectKey: string,
  title?: string,
): Promise<ChatSessionInfo> {
  const res = await apiFetch(`/api/projects/${encodeProjectRef(projectKey)}/chat/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) throw new Error("Failed to create session");
  const json = await res.json();
  return json.data;
}

/**
 * Get messages for a session
 */
export async function getSessionMessages(
  projectKey: string,
  sessionId: string,
): Promise<ChatMessageInfo[]> {
  const res = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  if (!res.ok) throw new Error("Failed to get session messages");
  const json = await res.json();
  return json.data?.messages ?? [];
}

/**
 * Rename a session
 */
export async function renameSession(
  projectKey: string,
  sessionId: string,
  title: string,
): Promise<ChatSessionInfo> {
  const res = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  if (!res.ok) throw new Error("Failed to rename session");
  const json = await res.json();
  return json.data;
}

/**
 * Delete a session
 */
export async function deleteSession(
  projectKey: string,
  sessionId: string,
): Promise<void> {
  const res = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("Failed to delete session");
}
