import assert from "node:assert/strict";
import { test } from "node:test";

import { createDocumentFlowViewState } from "../src/features/document-page/document-flow-orchestrator";

test("document-page orchestrator prefers cached document over fallback document", () => {
  const viewState = createDocumentFlowViewState({
    resolvedDocumentId: "doc-1",
    documentsById: {
      "doc-1": { id: "doc-1", title: "From cache", lock: null },
    },
    document: { id: "doc-1", title: "Fallback", lock: null },
    activeTrashNodeKey: null,
    trashPreviewByKey: {},
    blockCommentState: { panelByDocId: {}, countByDocId: {}, threadIdsByDocId: {} },
    blockCommentThreadsByKey: {},
    blockCommentLoadingByKey: {},
    blockCommentAnchorByDocId: {},
    trashPanelOpen: false,
  });

  assert.equal(viewState.activeDocument?.title, "From cache");
  assert.equal(viewState.sideNavActiveId, "doc-1");
});

test("document-page orchestrator hides side nav active id while trash or ephemeral draft is active", () => {
  const baseInput = {
    resolvedDocumentId: "__ephemeral_draft__",
    documentsById: {},
    document: { id: "__ephemeral_draft__", title: "草稿", lock: null },
    activeTrashNodeKey: null,
    trashPreviewByKey: {},
    blockCommentState: { panelByDocId: {}, countByDocId: {}, threadIdsByDocId: {} },
    blockCommentThreadsByKey: {},
    blockCommentLoadingByKey: {},
    blockCommentAnchorByDocId: {},
  };

  assert.equal(createDocumentFlowViewState({ ...baseInput, trashPanelOpen: false }).sideNavActiveId, null);
  assert.equal(createDocumentFlowViewState({ ...baseInput, resolvedDocumentId: "doc-1", trashPanelOpen: true }).sideNavActiveId, null);
});

test("document-page orchestrator derives visible comment panel only for non-trash non-ephemeral docs", () => {
  const viewState = createDocumentFlowViewState({
    resolvedDocumentId: "doc-1",
    documentsById: {
      "doc-1": { id: "doc-1", title: "Doc", lock: null },
    },
    document: null,
    activeTrashNodeKey: null,
    trashPreviewByKey: {},
    blockCommentState: {
      panelByDocId: {
        "doc-1": { visible: true, blockId: "block-1", threadId: null },
      },
      countByDocId: {},
      threadIdsByDocId: {},
    },
    blockCommentThreadsByKey: {
      "doc-1::block-1": [{ id: "thread-1" }],
    },
    blockCommentLoadingByKey: {
      "doc-1::block-1": true,
    },
    blockCommentAnchorByDocId: {
      "doc-1": { blockId: "block-1" },
    },
    trashPanelOpen: false,
  });

  assert.equal(viewState.activeCommentKey, "doc-1::block-1");
  assert.equal(viewState.activeCommentThreads.length, 1);
  assert.equal(viewState.activeCommentLoading, true);
  assert.equal(viewState.activeCommentVisible, true);
});
