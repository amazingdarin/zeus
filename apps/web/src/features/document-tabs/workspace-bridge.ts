import type { JSONContent } from "@tiptap/react";
import type { DocumentEditorSaveStatus } from "../../components/DocumentHeader";

export type SelectionRange = {
  from: number;
  to: number;
};

export type SelectionLike = SelectionRange | null | undefined;

export type WorkspaceSnapshot = {
  scrollTop: number;
  selection: SelectionRange | null;
  draftTitle: string;
  draftContent: JSONContent;
  locked?: boolean;
  saveStatus: DocumentEditorSaveStatus;
};

export type WorkspaceBridge = {
  captureSnapshot: () => WorkspaceSnapshot;
  restoreSnapshot: (snapshot: WorkspaceSnapshot) => void;
  flush: () => Promise<void>;
};

export function toSelectionRange(selection: SelectionLike): SelectionRange | null {
  if (!selection) {
    return null;
  }
  return {
    from: selection.from,
    to: selection.to,
  };
}
