/**
 * Document Optimization API Client
 */

import { apiFetch, buildApiUrl, encodeProjectRef } from "../config/api";
import type { JSONContent } from "@tiptap/react";

// ============================================================================
// Types
// ============================================================================

export type OptimizeMode = "format" | "content" | "full";

export type OptimizeOptions = {
  mode: OptimizeMode;
  preserveStructure?: boolean;
  language?: string;
};

export type OptimizeTaskStatus = "pending" | "running" | "completed" | "failed";

export type OptimizeTask = {
  id: string;
  status: OptimizeTaskStatus;
  originalMarkdown: string;
  optimizedMarkdown: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type OptimizeResult = {
  originalMarkdown: string;
  optimizedMarkdown: string;
  optimizedContent: JSONContent;
};

// ============================================================================
// API Functions
// ============================================================================

/**
 * Start a document optimization task
 */
export const startOptimize = async (
  projectKey: string,
  docId: string,
  options: OptimizeOptions,
): Promise<{ taskId: string }> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/optimize`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to start optimization");
  }
  const payload = await response.json();
  return { taskId: payload?.data?.taskId || "" };
};

/**
 * Get optimization task status
 */
export const getOptimizeStatus = async (
  projectKey: string,
  docId: string,
  taskId: string,
): Promise<OptimizeTask> => {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/optimize/${encodeURIComponent(taskId)}`,
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to get optimization status");
  }
  const payload = await response.json();
  const data = payload?.data ?? {};
  return {
    id: String(data.id ?? ""),
    status: data.status ?? "pending",
    originalMarkdown: String(data.originalMarkdown ?? ""),
    optimizedMarkdown: String(data.optimizedMarkdown ?? ""),
    error: data.error,
    createdAt: Number(data.createdAt ?? 0),
    updatedAt: Number(data.updatedAt ?? 0),
  };
};

/**
 * Build the SSE stream URL for optimization
 */
export const buildOptimizeStreamUrl = (
  projectKey: string,
  docId: string,
  taskId: string,
): string => {
  return buildApiUrl(`/api/projects/${encodeProjectRef(projectKey)}/documents/${encodeURIComponent(docId)}/optimize/${encodeURIComponent(taskId)}/stream`);
};

/**
 * Create an EventSource for streaming optimization results
 */
export const createOptimizeStream = (
  projectKey: string,
  docId: string,
  taskId: string,
): EventSource => {
  const url = buildOptimizeStreamUrl(projectKey, docId, taskId);
  return new EventSource(url);
};

/**
 * Parse SSE data payload
 */
export const parseOptimizeEvent = (
  data: string,
): { content?: string; originalMarkdown?: string; optimizedMarkdown?: string; optimizedContent?: JSONContent; error?: string } => {
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
};
