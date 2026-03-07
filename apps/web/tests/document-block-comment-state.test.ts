import assert from "node:assert/strict";
import test from "node:test";

import {
  createBlockCommentState,
  reduceBlockCommentState,
} from "../src/features/document-page/block-comment-state";

test("open panel stores active block context per doc", () => {
  let state = createBlockCommentState();
  state = reduceBlockCommentState(state, { type: "open-panel", docId: "d1", blockId: "b1" });
  state = reduceBlockCommentState(state, { type: "open-panel", docId: "d2", blockId: "b2" });
  assert.equal(state.panelByDocId["d1"]?.blockId, "b1");
  assert.equal(state.panelByDocId["d2"]?.blockId, "b2");
});

test("upsert thread updates per-block count", () => {
  let state = createBlockCommentState();
  state = reduceBlockCommentState(state, { type: "upsert-thread", docId: "d1", blockId: "b1", threadId: "t1" });
  assert.equal(state.countByDocId["d1"]?.["b1"], 1);
  state = reduceBlockCommentState(state, { type: "upsert-thread", docId: "d1", blockId: "b1", threadId: "t1" });
  assert.equal(state.countByDocId["d1"]?.["b1"], 1);
  state = reduceBlockCommentState(state, { type: "remove-thread", docId: "d1", blockId: "b1", threadId: "t1" });
  assert.equal(state.countByDocId["d1"]?.["b1"], 0);
});
