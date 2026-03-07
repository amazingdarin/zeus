import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCommentContentInput,
  parseCommentListQuery,
  parseCommentStatusInput,
} from "../src/services/document-block-comment-http.ts";

test("parseCommentListQuery accepts blockId/status/limit", () => {
  const parsed = parseCommentListQuery({
    blockId: "b1",
    status: "open",
    cursor: "abc",
    limit: "20",
  });
  assert.equal(parsed.blockId, "b1");
  assert.equal(parsed.status, "open");
  assert.equal(parsed.cursor, "abc");
  assert.equal(parsed.limit, 20);
});

test("parseCommentStatusInput rejects unsupported status", () => {
  assert.equal(parseCommentStatusInput({ status: "closed" }), null);
  assert.equal(parseCommentStatusInput({ status: "resolved" }), "resolved");
});

test("parseCommentContentInput trims whitespace", () => {
  assert.equal(parseCommentContentInput("  hello  "), "hello");
  assert.equal(parseCommentContentInput(" "), "");
});
