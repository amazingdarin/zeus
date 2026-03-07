import assert from "node:assert/strict";
import test from "node:test";

import {
  createBlockCommentState,
  reduceBlockCommentState,
} from "../src/features/document-page/block-comment-state";

test("tab switch restores panel context for each document", () => {
  let state = createBlockCommentState();
  state = reduceBlockCommentState(state, {
    type: "open-panel",
    docId: "doc-a",
    blockId: "block-a",
  });
  state = reduceBlockCommentState(state, {
    type: "open-panel",
    docId: "doc-b",
    blockId: "block-b",
  });

  assert.equal(state.panelByDocId["doc-a"]?.blockId, "block-a");
  assert.equal(state.panelByDocId["doc-b"]?.blockId, "block-b");
});
