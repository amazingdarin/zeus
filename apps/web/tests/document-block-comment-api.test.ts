import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBlockCommentThreadsPath,
  mapDocumentBlockCommentThread,
} from "../src/api/documents";

test("buildBlockCommentThreadsPath uses scoped route and query", () => {
  const path = buildBlockCommentThreadsPath("personal::me::p1", "d1", {
    blockId: "b1",
    status: "open",
    limit: 20,
  });
  assert.equal(path, "/api/projects/personal/me/p1/documents/d1/block-comments?blockId=b1&status=open&limit=20");
});

test("mapDocumentBlockCommentThread normalizes nested messages", () => {
  const mapped = mapDocumentBlockCommentThread({
    thread: {
      id: "t1",
      docId: "d1",
      blockId: "b1",
      status: "open",
      createdBy: "u1",
      createdAt: "2026-03-04T10:00:00.000Z",
      updatedAt: "2026-03-04T10:00:00.000Z",
    },
    messages: [{ id: "m1", threadId: "t1", content: "hello", authorId: "u1" }],
  });

  assert.equal(mapped.id, "t1");
  assert.equal(mapped.docId, "d1");
  assert.equal(mapped.blockId, "b1");
  assert.equal(mapped.messages.length, 1);
  assert.equal(mapped.messages[0]?.id, "m1");
  assert.equal(mapped.messages[0]?.authorId, "u1");
});
