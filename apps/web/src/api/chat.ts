import { apiFetch, buildApiUrl } from "../config/api";

export const createChatRun = async (
  projectKey: string,
  message: string,
  sessionId?: string,
): Promise<string> => {
  const response = await apiFetch(`/api/projects/${projectKey}/chat/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(sessionId ? { session_id: sessionId } : {}),
      message,
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
