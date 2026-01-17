import { apiFetch, buildApiUrl, ensureSystemSession } from "../config/api";

const getSessionId = async (): Promise<string> => {
  const findCookie = () =>
    document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith("zeus_session_id="));
  const cookie = findCookie();
  if (cookie) {
    return decodeURIComponent(cookie.split("=")[1] ?? "");
  }
  await ensureSystemSession();
  const refreshed = findCookie();
  return refreshed ? decodeURIComponent(refreshed.split("=")[1] ?? "") : "";
};

export const createChatRun = async (projectKey: string, message: string) => {
  const sessionId = await getSessionId();
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

export const buildChatStreamUrl = (projectKey: string, runId: string) => {
  return buildApiUrl(`/api/projects/${projectKey}/chat/runs/${runId}/stream`);
};
