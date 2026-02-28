import type { JSONContent } from "@tiptap/react";
import type { DocumentEditorSaveStatus } from "../../components/DocumentHeader";

export type DocSnapshot = {
  scrollTop: number;
  selection: { from: number; to: number } | null;
  draftTitle: string;
  draftContent: JSONContent;
  saveStatus: DocumentEditorSaveStatus;
};

export type SnapshotStore = Record<string, DocSnapshot>;

export function createSnapshotStore(): SnapshotStore {
  return {};
}

export function upsertSnapshot(
  store: SnapshotStore,
  docId: string,
  snapshot: DocSnapshot,
): SnapshotStore {
  return {
    ...store,
    [docId]: snapshot,
  };
}

export function removeSnapshot(store: SnapshotStore, docId: string): SnapshotStore {
  const next = { ...store };
  delete next[docId];
  return next;
}
