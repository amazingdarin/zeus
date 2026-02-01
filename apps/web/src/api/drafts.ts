/**
 * Draft API Client
 *
 * API client for managing AI-generated document drafts.
 */

import type { JSONContent } from "@tiptap/react";
import { apiFetch } from "../config/api";

/**
 * Document draft from the backend
 */
export type DocumentDraft = {
  id: string;
  projectKey: string;
  docId: string | null;
  parentId: string | null;
  title: string;
  originalContent: JSONContent | null;
  proposedContent: JSONContent;
  status: "pending" | "applied" | "rejected";
  createdAt: number;
  expiresAt: number;
};

/**
 * Get a draft by ID
 */
export async function getDraft(
  projectKey: string,
  draftId: string,
): Promise<DocumentDraft> {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/drafts/${encodeURIComponent(draftId)}`,
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to get draft");
  }

  const payload = await response.json();
  return payload.data as DocumentDraft;
}

/**
 * Apply a draft (save the document)
 */
export async function applyDraft(
  projectKey: string,
  draftId: string,
  options?: {
    modifiedContent?: JSONContent;
    parentId?: string | null;
  },
): Promise<{ docId: string; isNew: boolean }> {
  const body: { modifiedContent?: JSONContent; parentId?: string | null } = {};
  if (options?.modifiedContent) {
    body.modifiedContent = options.modifiedContent;
  }
  if (options?.parentId !== undefined) {
    body.parentId = options.parentId;
  }

  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/drafts/${encodeURIComponent(draftId)}/apply`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to apply draft");
  }

  const payload = await response.json();
  return payload.data as { docId: string; isNew: boolean };
}

/**
 * Reject a draft
 */
export async function rejectDraft(
  projectKey: string,
  draftId: string,
): Promise<void> {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/drafts/${encodeURIComponent(draftId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to reject draft");
  }
}

/**
 * List pending drafts for a project
 */
export async function listPendingDrafts(
  projectKey: string,
): Promise<DocumentDraft[]> {
  const response = await apiFetch(
    `/api/projects/${encodeURIComponent(projectKey)}/drafts`,
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "Failed to list drafts");
  }

  const payload = await response.json();
  return (payload.data ?? []) as DocumentDraft[];
}
