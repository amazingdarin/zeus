import { apiFetch, buildApiUrl } from "../config/api";

export type DocumentScope = {
  docId: string;
  includeChildren: boolean;
};

export type CreateChatRunOptions = {
  sessionId?: string;
  documentScope?: DocumentScope[];
  deepSearch?: boolean;
};

export const createChatRun = async (
  projectKey: string,
  message: string,
  options?: CreateChatRunOptions,
): Promise<string> => {
  const { sessionId, documentScope, deepSearch } = options || {};

  // Convert to API format
  const apiDocScope = documentScope?.map((s) => ({
    doc_id: s.docId,
    include_children: s.includeChildren,
  }));

  const response = await apiFetch(`/api/projects/${projectKey}/chat/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(sessionId ? { session_id: sessionId } : {}),
      message,
      ...(apiDocScope && apiDocScope.length > 0 ? { document_scope: apiDocScope } : {}),
      ...(deepSearch ? { deep_search: true } : {}),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const messageText = payload?.message || "Failed to create chat run";
    throw new Error(messageText);
  }
  const runId = String(payload?.data?.run_id ?? "");
  if (!runId) {
    throw new Error("Missing run id");
  }
  return runId;
};

export const buildChatStreamUrl = (projectKey: string, runId: string): string => {
  return buildApiUrl(`/api/projects/${projectKey}/chat/runs/${runId}/stream`);
};

export const clearChatSession = async (
  projectKey: string,
  sessionId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${projectKey}/chat/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error("Failed to clear chat session");
  }
};

/**
 * Pending tool call type for confirmation UI
 */
export type PendingToolCall = {
  id: string;
  skillName: string;
  skillDescription: string;
  args: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high";
  warningMessage?: string;
  createdAt: number;
  expiresAt: number;
};

/**
 * Confirm a pending tool execution
 */
export const confirmTool = async (
  projectKey: string,
  runId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${projectKey}/chat/runs/${encodeURIComponent(runId)}/confirm-tool`,
    { method: "POST" },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to confirm tool");
  }
};

/**
 * Reject a pending tool execution
 */
export const rejectTool = async (
  projectKey: string,
  runId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${projectKey}/chat/runs/${encodeURIComponent(runId)}/reject-tool`,
    { method: "POST" },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to reject tool");
  }
};
