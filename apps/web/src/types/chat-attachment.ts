/**
 * Chat attachment types
 */

export type ChatAttachmentType = "file" | "image" | "url";

export type ChatAttachmentStatus = "uploading" | "fetching" | "ready" | "error";

export type ChatAttachment = {
  /** Unique identifier */
  id: string;
  /** Attachment type */
  type: ChatAttachmentType;
  /** Display name (filename or URL) */
  name: string;
  /** Current processing status */
  status: ChatAttachmentStatus;
  /** Backend asset id (for file/image attachments) */
  assetId?: string;
  /** Extracted/fetched content for AI context */
  content?: string;
  /** Base64 preview URL for images */
  preview?: string;
  /** Error message if status is 'error' */
  error?: string;
  /** MIME type for files */
  mimeType?: string;
  /** File size in bytes */
  size?: number;
  /** Original URL for URL attachments */
  originalUrl?: string;
};

/**
 * Response from attachment upload API
 */
export type AttachmentUploadResponse = {
  id: string;
  type: ChatAttachmentType;
  name: string;
  assetId?: string;
  content?: string;
  preview?: string;
  mimeType?: string;
  size?: number;
  originalUrl?: string;
  fetchedAt?: string;
};
