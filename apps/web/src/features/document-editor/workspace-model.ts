import type { EditorSaveStatus } from "./save-state";
import type { JSONContent } from "@tiptap/react";

type FlushReason = "route-leave" | "project-switch" | "window-blur" | "manual-retry" | "input";

export function shouldFlushOn(reason: FlushReason | string): boolean {
  return reason === "route-leave" || reason === "project-switch" || reason === "window-blur";
}

export function mapSaveStatusText(status: EditorSaveStatus): string {
  if (status === "draft") {
    return "草稿";
  }
  if (status === "saving") {
    return "保存中...";
  }
  if (status === "error") {
    return "保存失败";
  }
  if (status === "dirty") {
    return "待保存";
  }
  return "已保存";
}

type IncomingWorkspaceSyncInput = {
  saveStatus: EditorSaveStatus;
  incomingTitle: string;
  localTitle: string;
  incomingSerialized: string;
  localSerialized: string;
  force: boolean;
};

export function shouldApplyIncomingWorkspaceState(
  input: IncomingWorkspaceSyncInput,
): boolean {
  if (input.force) {
    return true;
  }

  const titleChanged = input.incomingTitle !== input.localTitle;
  const contentChanged = input.incomingSerialized !== input.localSerialized;
  if (!titleChanged && !contentChanged) {
    return false;
  }

  return input.saveStatus === "idle";
}

export function isMeaningfulDraftChange(input: {
  title: string;
  content: JSONContent;
  defaultTitle: string;
}): boolean {
  const normalizedTitle = input.title.trim();
  const normalizedDefaultTitle = input.defaultTitle.trim();
  if (normalizedTitle !== normalizedDefaultTitle) {
    return true;
  }
  return hasMeaningfulDraftContent(input.content);
}

export function shouldPersistWorkspacePayload(input: {
  persistMode: "persisted" | "ephemeral";
  hasMaterialized: boolean;
}): boolean {
  if (input.persistMode === "persisted") {
    return true;
  }
  return input.hasMaterialized;
}

function hasMeaningfulDraftContent(content: JSONContent | null | undefined): boolean {
  if (!content || typeof content !== "object") {
    return false;
  }
  return isMeaningfulNode(content);
}

function isMeaningfulNode(node: JSONContent): boolean {
  const type = String(node.type || "").trim();
  const children = Array.isArray(node.content) ? node.content : [];

  if (type === "text") {
    return typeof node.text === "string" && node.text.trim().length > 0;
  }

  if (children.length > 0) {
    return children.some((child) => isMeaningfulNode(child));
  }

  if (
    type === ""
    || type === "doc"
    || type === "paragraph"
    || type === "heading"
    || type === "blockquote"
    || type === "bulletList"
    || type === "orderedList"
    || type === "listItem"
    || type === "taskList"
    || type === "taskItem"
    || type === "table"
    || type === "tableRow"
    || type === "tableCell"
    || type === "tableHeader"
    || type === "columns"
    || type === "column"
    || type === "hardBreak"
    || type === "horizontalRule"
  ) {
    return false;
  }

  // Non-container nodes without children (e.g. image/file/embed/code-block) count as meaningful.
  return true;
}
