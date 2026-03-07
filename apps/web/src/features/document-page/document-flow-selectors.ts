import { EPHEMERAL_DRAFT_ID } from "./ephemeral-draft-model";

export function buildBlockCommentKey(docId: string, blockId: string): string {
  return `${String(docId ?? "").trim()}::${String(blockId ?? "").trim()}`;
}

export function selectDocumentSideNavActiveId(input: {
  trashPanelOpen: boolean;
  resolvedDocumentId: string | null | undefined;
}): string | null {
  if (input.trashPanelOpen) {
    return null;
  }
  const resolvedDocumentId = String(input.resolvedDocumentId ?? "").trim();
  if (!resolvedDocumentId || resolvedDocumentId === EPHEMERAL_DRAFT_ID) {
    return null;
  }
  return resolvedDocumentId;
}
