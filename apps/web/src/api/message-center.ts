import { apiFetch, buildApiUrl, encodeProjectRef } from "../config/api";

export type MessageProgress = {
  current?: number;
  total?: number;
  percent?: number;
  message?: string;
  phase?: string;
};

export type MessageItem = {
  id: string;
  type: string;
  title: string;
  status: string;
  progress?: MessageProgress;
  detail?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type MessageCenterResponse = {
  active: MessageItem[];
  history: MessageItem[];
  nextCursor?: string;
};

export const fetchMessageCenter = async (
  projectKey: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<MessageCenterResponse> => {
  const params = new URLSearchParams();
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  const query = params.toString();
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/message-center${query ? `?${query}` : ""}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load message center");
  }
  const payload = await response.json().catch(() => null);
  const data = payload?.data ?? payload ?? {};
  return {
    active: Array.isArray(data.active) ? data.active : [],
    history: Array.isArray(data.history) ? data.history : [],
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : undefined,
  };
};

export const buildMessageCenterStreamUrl = (projectKey: string) =>
  buildApiUrl(`/api/projects/${encodeProjectRef(projectKey)}/message-center/stream`);

export const createMessageCenterStream = (projectKey: string): EventSource => {
  const url = buildMessageCenterStreamUrl(projectKey);
  return new EventSource(url);
};
