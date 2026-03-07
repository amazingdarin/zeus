import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMENT_THREAD_STATUSES,
  canDeleteCommentMessage,
  canWriteComment,
  normalizeCommentThreadStatus,
} from "../src/services/document-block-comment-model.ts";

test("normalizeCommentThreadStatus only accepts open/resolved", () => {
  assert.equal(COMMENT_THREAD_STATUSES.has("open"), true);
  assert.equal(COMMENT_THREAD_STATUSES.has("resolved"), true);
  assert.equal(normalizeCommentThreadStatus("open"), "open");
  assert.equal(normalizeCommentThreadStatus("resolved"), "resolved");
  assert.equal(normalizeCommentThreadStatus("closed"), null);
  assert.equal(normalizeCommentThreadStatus(""), null);
});

test("canWriteComment allows owner admin member only", () => {
  assert.equal(canWriteComment("owner"), true);
  assert.equal(canWriteComment("admin"), true);
  assert.equal(canWriteComment("member"), true);
  assert.equal(canWriteComment("viewer"), false);
  assert.equal(canWriteComment("guest"), false);
});

test("message delete permission allows author and owner/admin", () => {
  assert.equal(canDeleteCommentMessage({ actorId: "u1", authorId: "u1", role: "member" }), true);
  assert.equal(canDeleteCommentMessage({ actorId: "u2", authorId: "u1", role: "admin" }), true);
  assert.equal(canDeleteCommentMessage({ actorId: "u2", authorId: "u1", role: "owner" }), true);
  assert.equal(canDeleteCommentMessage({ actorId: "u2", authorId: "u1", role: "member" }), false);
});
