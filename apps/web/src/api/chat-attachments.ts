/**
 * Chat attachments API client
 */

import { apiFetch, encodeProjectRef } from "../config/api";
import type { AttachmentUploadResponse } from "../types/chat-attachment";

/**
 * Upload a file attachment
 */
export async function uploadFileAttachment(
  projectKey: string,
  file: File
): Promise<AttachmentUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/attachments`,
    {
      method: "POST",
      body: formData,
      // Don't set Content-Type header - browser will set it with boundary
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Upload failed: ${response.status}`);
  }

  const result = await response.json();
  const data = result.data as Record<string, unknown> | null;
  if (!data) {
    throw new Error("Missing attachment data");
  }
  return {
    ...(data as AttachmentUploadResponse),
    assetId: typeof (data as { asset_id?: unknown }).asset_id === "string"
      ? String((data as { asset_id?: unknown }).asset_id)
      : undefined,
  };
}

/**
 * Fetch URL content as attachment
 */
export async function fetchUrlAttachment(
  projectKey: string,
  url: string
): Promise<AttachmentUploadResponse> {
  const response = await apiFetch(
    `/api/projects/${encodeProjectRef(projectKey)}/chat/attachments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Fetch URL failed: ${response.status}`);
  }

  const result = await response.json();
  const data = result.data as Record<string, unknown> | null;
  if (!data) {
    throw new Error("Missing attachment data");
  }
  return {
    ...(data as AttachmentUploadResponse),
    assetId: typeof (data as { asset_id?: unknown }).asset_id === "string"
      ? String((data as { asset_id?: unknown }).asset_id)
      : undefined,
  };
}

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const trimmed = text.trim();
  // Must start with http:// or https://
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return false;
  }
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}
