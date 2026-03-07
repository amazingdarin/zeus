import type { DocumentLockInfo } from "../../api/documents";

import { EPHEMERAL_DRAFT_ID } from "./ephemeral-draft-model";
import { mapDocumentLockViewState } from "./lock-view-state";
import { buildBlockCommentKey, selectDocumentSideNavActiveId } from "./document-flow-selectors";

type CommentPanelState = {
  visible: boolean;
  blockId: string | null;
  threadId: string | null;
};

export function createDocumentFlowViewState<
  TDocument extends { id: string; title: string; lock: DocumentLockInfo | null },
  TTrashPreview,
  TThread,
  TAnchor,
>(input: {
  resolvedDocumentId: string | null | undefined;
  documentsById: Record<string, TDocument>;
  document: TDocument | null;
  activeTrashNodeKey: string | null;
  trashPreviewByKey: Record<string, TTrashPreview>;
  blockCommentState: {
    panelByDocId: Record<string, CommentPanelState>;
  };
  blockCommentThreadsByKey: Record<string, Array<TThread>>;
  blockCommentLoadingByKey: Record<string, boolean>;
  blockCommentAnchorByDocId: Record<string, TAnchor>;
  trashPanelOpen: boolean;
}) {
  const resolvedDocumentId = String(input.resolvedDocumentId ?? "").trim();
  const activeDocument = (resolvedDocumentId ? input.documentsById[resolvedDocumentId] : null) ?? input.document;
  const isEphemeralActive = activeDocument?.id === EPHEMERAL_DRAFT_ID;
  const activeLock = !isEphemeralActive ? (activeDocument?.lock ?? null) : null;
  const activeLockViewState = mapDocumentLockViewState(activeLock);
  const activeTrashPreview = input.activeTrashNodeKey
    ? (input.trashPreviewByKey[input.activeTrashNodeKey] ?? null)
    : null;

  const activeDocId = String(activeDocument?.id ?? "").trim();
  const activeCommentPanel = activeDocId
    ? (input.blockCommentState.panelByDocId[activeDocId] ?? {
        visible: false,
        blockId: null,
        threadId: null,
      })
    : { visible: false, blockId: null, threadId: null };
  const activeCommentBlockId = String(activeCommentPanel.blockId ?? "").trim() || null;
  const activeCommentKey = activeDocId && activeCommentBlockId
    ? buildBlockCommentKey(activeDocId, activeCommentBlockId)
    : "";
  const activeCommentThreads = activeCommentKey
    ? (input.blockCommentThreadsByKey[activeCommentKey] ?? [])
    : [];
  const activeCommentAnchor = activeDocId
    ? (input.blockCommentAnchorByDocId[activeDocId] ?? null)
    : null;
  const activeCommentLoading = activeCommentKey
    ? Boolean(input.blockCommentLoadingByKey[activeCommentKey])
    : false;
  const activeCommentVisible = Boolean(
    activeCommentPanel.visible
      && activeDocId
      && activeCommentBlockId
      && !input.trashPanelOpen
      && !isEphemeralActive,
  );

  return {
    activeDocument,
    isEphemeralActive,
    activeLock,
    activeLockViewState,
    isActiveDocumentLocked: activeLockViewState.readonly,
    activeTrashPreview,
    activeCommentPanel,
    activeCommentBlockId,
    activeCommentKey,
    activeCommentThreads,
    activeCommentAnchor,
    activeCommentLoading,
    activeCommentVisible,
    sideNavActiveId: selectDocumentSideNavActiveId({
      trashPanelOpen: input.trashPanelOpen,
      resolvedDocumentId,
    }),
  };
}
