/**
 * ChatAttachmentTags - Display attached files/URLs as tags
 */

import {
  FileTextOutlined,
  PictureOutlined,
  LinkOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from "@ant-design/icons";
import type { ChatAttachment } from "../types/chat-attachment";

type ChatAttachmentTagsProps = {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
};

function ChatAttachmentTags({ attachments, onRemove }: ChatAttachmentTagsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="chat-attachment-tags">
      {attachments.map((attachment) => (
        <AttachmentTag
          key={attachment.id}
          attachment={attachment}
          onRemove={() => onRemove(attachment.id)}
        />
      ))}
    </div>
  );
}

type AttachmentTagProps = {
  attachment: ChatAttachment;
  onRemove: () => void;
};

function AttachmentTag({ attachment, onRemove }: AttachmentTagProps) {
  const { type, name, status, error, preview } = attachment;
  const isLoading = status === "uploading" || status === "fetching";
  const isError = status === "error";

  // Determine icon based on type
  const getIcon = () => {
    if (isLoading) {
      return <LoadingOutlined spin />;
    }
    if (isError) {
      return <ExclamationCircleOutlined />;
    }
    switch (type) {
      case "image":
        return <PictureOutlined />;
      case "url":
        return <LinkOutlined />;
      default:
        return <FileTextOutlined />;
    }
  };

  // Truncate long names
  const displayName = name.length > 30 ? `${name.slice(0, 27)}...` : name;

  // Status text
  const getStatusText = () => {
    if (status === "uploading") return "上传中...";
    if (status === "fetching") return "抓取中...";
    return null;
  };

  const statusText = getStatusText();

  return (
    <span
      className={`chat-attachment-tag chat-attachment-tag--${type} ${
        isLoading ? "chat-attachment-tag--loading" : ""
      } ${isError ? "chat-attachment-tag--error" : ""}`}
      title={error || name}
    >
      {/* Image preview thumbnail */}
      {type === "image" && preview && !isLoading && !isError && (
        <img
          src={preview}
          alt={name}
          className="chat-attachment-tag-preview"
        />
      )}
      
      {/* Icon (only show if no preview or loading/error) */}
      {(type !== "image" || !preview || isLoading || isError) && (
        <span className="chat-attachment-tag-icon">{getIcon()}</span>
      )}
      
      {/* Name and status */}
      <span className="chat-attachment-tag-text">
        {statusText || displayName}
      </span>
      
      {/* Remove button */}
      <button
        type="button"
        className="chat-attachment-tag-remove"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        aria-label="移除附件"
      >
        <CloseCircleOutlined />
      </button>
    </span>
  );
}

export default ChatAttachmentTags;
