import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBlockCommentCountByBlockId,
  resolveBlockCommentPopoverPosition,
  type BlockCommentAnchorRect,
} from "../src/features/document-page/block-comment-floating";

test("buildBlockCommentCountByBlockId counts unique thread ids by block", () => {
  const counts = buildBlockCommentCountByBlockId([
    { id: "t1", blockId: "b1" },
    { id: "t1", blockId: "b1" },
    { id: "t2", blockId: "b1" },
    { id: "t3", blockId: "b2" },
    { id: "", blockId: "b2" },
    { id: "t4", blockId: "" },
  ]);

  assert.deepEqual(counts, {
    b1: 2,
    b2: 1,
  });
});

test("resolveBlockCommentPopoverPosition keeps popover near anchor and inside viewport", () => {
  const anchor: BlockCommentAnchorRect = {
    left: 820,
    top: 480,
    width: 200,
    height: 36,
  };

  const point = resolveBlockCommentPopoverPosition({
    anchor,
    panel: { width: 360, height: 300 },
    viewport: { width: 1280, height: 900 },
    margin: 12,
    topInset: 64,
  });

  assert.equal(point.left, 740);
  assert.equal(point.top, 366);
});

test("resolveBlockCommentPopoverPosition centers when anchor missing", () => {
  const point = resolveBlockCommentPopoverPosition({
    anchor: null,
    panel: { width: 320, height: 200 },
    viewport: { width: 1000, height: 700 },
    margin: 10,
    topInset: 40,
  });

  assert.equal(point.left, 340);
  assert.equal(point.top, 250);
});
