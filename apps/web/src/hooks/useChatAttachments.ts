/**
 * Hook for managing chat attachments
 */

import { useState, useCallback } from "react";
import type { ChatAttachment } from "../types/chat-attachment";
import {
  uploadFileAttachment,
  fetchUrlAttachment,
  isValidUrl,
} from "../api/chat-attachments";

/** Generate unique ID */
function generateId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type UseChatAttachmentsReturn = {
  /** Current attachments */
  attachments: ChatAttachment[];
  /** Add a file attachment */
  addFile: (projectKey: string, file: File) => void;
  /** Add a URL attachment */
  addUrl: (projectKey: string, url: string) => void;
  /** Remove an attachment by ID */
  removeAttachment: (id: string) => void;
  /** Clear all attachments */
  clearAttachments: () => void;
  /** Check if there are any attachments */
  hasAttachments: boolean;
  /** Check if any attachments are still loading */
  isLoading: boolean;
  /** Get attachments content for sending */
  getAttachmentsContext: () => string;
};

export function useChatAttachments(): UseChatAttachmentsReturn {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const addFile = useCallback((projectKey: string, file: File) => {
    const id = generateId();
    const isImage = file.type.startsWith("image/");
    
    // Create initial attachment with loading state
    const newAttachment: ChatAttachment = {
      id,
      type: isImage ? "image" : "file",
      name: file.name,
      status: "uploading",
      mimeType: file.type,
      size: file.size,
    };

    // If image, create local preview immediately
    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, preview: e.target?.result as string } : a
          )
        );
      };
      reader.readAsDataURL(file);
    }

    setAttachments((prev) => [...prev, newAttachment]);

    // Upload file
    uploadFileAttachment(projectKey, file)
      .then((response) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "ready",
                  content: response.content,
                  preview: response.preview || a.preview,
                }
              : a
          )
        );
      })
      .catch((err) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "error",
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : a
          )
        );
      });
  }, []);

  const addUrl = useCallback((projectKey: string, url: string) => {
    if (!isValidUrl(url)) {
      return;
    }

    const id = generateId();
    const trimmedUrl = url.trim();

    // Create initial attachment with fetching state
    const newAttachment: ChatAttachment = {
      id,
      type: "url",
      name: trimmedUrl,
      status: "fetching",
    };

    setAttachments((prev) => [...prev, newAttachment]);

    // Fetch URL content
    fetchUrlAttachment(projectKey, trimmedUrl)
      .then((response) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "ready",
                  content: response.content,
                  originalUrl: response.originalUrl,
                }
              : a
          )
        );
      })
      .catch((err) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "error",
                  error: err instanceof Error ? err.message : "Fetch failed",
                }
              : a
          )
        );
      });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const hasAttachments = attachments.length > 0;

  const isLoading = attachments.some(
    (a) => a.status === "uploading" || a.status === "fetching"
  );

  const getAttachmentsContext = useCallback(() => {
    const readyAttachments = attachments.filter((a) => a.status === "ready");
    if (readyAttachments.length === 0) {
      return "";
    }

    const parts: string[] = [];
    
    for (const att of readyAttachments) {
      if (att.type === "url") {
        parts.push(`[网页内容: ${att.name}]\n${att.content || ""}`);
      } else if (att.type === "image") {
        parts.push(`[图片: ${att.name}]`);
      } else {
        parts.push(`[文件: ${att.name}]\n${att.content || ""}`);
      }
    }

    return parts.join("\n\n");
  }, [attachments]);

  return {
    attachments,
    addFile,
    addUrl,
    removeAttachment,
    clearAttachments,
    hasAttachments,
    isLoading,
    getAttachmentsContext,
  };
}

// Re-export for convenience
export { isValidUrl };
