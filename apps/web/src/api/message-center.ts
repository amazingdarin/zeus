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

const getAccessToken = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem("zeus_access_token");
  } catch {
    return null;
  }
};

const appendAccessTokenForSse = (url: string): string => {
  const token = getAccessToken();
  if (!token || url.includes("access_token=")) {
    return url;
  }
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(url, base);
    parsed.searchParams.set("access_token", token);
    if (/^https?:\/\//.test(url)) {
      return parsed.toString();
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}access_token=${encodeURIComponent(token)}`;
  }
};

export const fetchMessageCenter = async (
  projectKey: string,
  options: { limit?: number; cursor?: string; type?: string } = {},
): Promise<MessageCenterResponse> => {
  const params = new URLSearchParams();
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (options.cursor) {
    params.set("cursor", options.cursor);
  }
  if (options.type) {
    params.set("type", options.type);
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
  appendAccessTokenForSse(buildApiUrl(`/api/projects/${encodeProjectRef(projectKey)}/message-center/stream`));

export const createMessageCenterStream = (projectKey: string): EventSource => {
  const url = buildMessageCenterStreamUrl(projectKey);
  return new EventSource(url);
};
