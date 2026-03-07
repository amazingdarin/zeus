import { apiFetch, buildApiUrl, encodeProjectRef } from "../config/api";

export type DocumentScope = {
  docId: string;
  includeChildren: boolean;
};

export type CreateChatRunOptions = {
  sessionId?: string;
  documentScope?: DocumentScope[];
  deepSearch?: boolean;
  attachments?: Array<{
    assetId: string;
    name: string;
    mimeType?: string;
    size?: number;
    type: "file" | "image";
  }>;
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

export const createChatRun = async (
  projectKey: string,
  message: string,
  options?: CreateChatRunOptions,
): Promise<string> => {
  const { sessionId, documentScope, deepSearch, attachments } = options || {};

  // Convert to API format
  const apiDocScope = documentScope?.map((s) => ({
    doc_id: s.docId,
    include_children: s.includeChildren,
  }));

  const apiAttachments = attachments?.map((a) => ({
    asset_id: a.assetId,
    name: a.name,
    ...(a.mimeType ? { mime_type: a.mimeType } : {}),
    ...(typeof a.size === "number" ? { size: a.size } : {}),
    type: a.type,
  }));

  const response = await apiFetch(`/api/projects/${encodeProjectRef(projectKey)}/chat/runs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(sessionId ? { session_id: sessionId } : {}),
      message,
      ...(apiDocScope && apiDocScope.length > 0 ? { document_scope: apiDocScope } : {}),
      ...(apiAttachments && apiAttachments.length > 0 ? { attachments: apiAttachments } : {}),
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
  const raw = buildApiUrl(`/api/projects/${encodeProjectRef(projectKey)}/chat/runs/${runId}/stream`);
  return appendAccessTokenForSse(raw);
};

export const clearChatSession = async (
  projectKey: string,
  sessionId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/sessions/${encodeURIComponent(sessionId)}`,
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

export type IntentOption = {
  type: "command" | "skill" | "deep_search" | "chat";
  skillHint?: string;
  label: string;
  confidence: number;
};

export type PendingIntentInfo = {
  message: string;
  options: IntentOption[];
};

export type PendingRequiredInputInfo =
  | {
      kind: "doc_scope";
      message: string;
      skillName: string;
      skillDescription: string;
    }
  | {
      kind: "skill_args";
      message: string;
      skillName: string;
      skillDescription: string;
      missing?: string[];
      issues?: Array<{ path: string; message: string }>;
      fields: Array<{
        key: string;
        type: string;
        description: string;
        enum?: string[];
        options?: Array<{
          value: string;
          label: string;
          description?: string;
          meta?: Record<string, unknown>;
        }>;
        widget?: "select" | "choice_list";
      }>;
      currentArgs?: Record<string, unknown>;
    };

export type PreflightTaskInfo = {
  taskId: string;
  title: string;
  subagentId: string;
  subagentName: string;
  status: "ready" | "missing_input" | "blocked" | "waiting_dependency";
  reason?: string;
};

export type PreflightMissingInput = {
  taskId: string;
  kind: "doc_scope" | "skill_args";
  skillName: string;
  message: string;
  fields?: Array<{
    key: string;
    type: string;
    description: string;
    enum?: string[];
    options?: Array<{
      value: string;
      label: string;
      description?: string;
      meta?: Record<string, unknown>;
    }>;
    widget?: "select" | "choice_list";
  }>;
  missing?: string[];
  issues?: Array<{ path: string; message: string }>;
  currentArgs?: Record<string, unknown>;
};

export type PendingPreflightInfo = {
  message: string;
  tasks: PreflightTaskInfo[];
  missingInputs: PreflightMissingInput[];
};

export type ChatTaskStatus = {
  taskId: string;
  title: string;
  skillId: string;
  index: number;
  total: number;
  failurePolicy: "required" | "best_effort";
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  message?: string;
  error?: string;
};

export type ProvideRequiredInputPayload =
  | { doc_id: string }
  | { args: Record<string, unknown> };

export type ProvidePreflightInputPayload = {
  taskInputs: Array<{
    taskId: string;
    doc_id?: string;
    args?: Record<string, unknown>;
  }>;
};

/**
 * Confirm a pending tool execution
 */
export const confirmTool = async (
  projectKey: string,
  runId: string,
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/runs/${encodeURIComponent(runId)}/confirm-tool`,
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
    `/api/projects/${encodeProjectRef(projectKey)}/chat/runs/${encodeURIComponent(runId)}/reject-tool`,
    { method: "POST" },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to reject tool");
  }
};

/**
 * Select an intent option for a pending intent clarification
 */
export const selectIntent = async (
  projectKey: string,
  runId: string,
  option: IntentOption,
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/runs/${encodeURIComponent(runId)}/select-intent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(option),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to select intent");
  }
};

/**
 * Provide required input for a pending clarification (e.g. doc scope)
 */
export const provideRequiredInput = async (
  projectKey: string,
  runId: string,
  payload: ProvideRequiredInputPayload,
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/runs/${encodeURIComponent(runId)}/provide-input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Failed to provide input");
  }
};

/**
 * Provide preflight input for pending preflight clarification.
 */
export const providePreflightInput = async (
  projectKey: string,
  runId: string,
  payload: ProvidePreflightInputPayload,
): Promise<void> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/runs/${encodeURIComponent(runId)}/provide-preflight-input`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Failed to provide preflight input");
  }
};
