import assert from "node:assert/strict"
import test from "node:test"

import { resolveBlockCommentCount } from "../src/templates/simple/block-comment-count"

test("resolveBlockCommentCount returns zero for missing block", () => {
  assert.equal(resolveBlockCommentCount("b1", {}), 0)
  assert.equal(resolveBlockCommentCount("b1", { b1: 2 }), 2)
  assert.equal(resolveBlockCommentCount("", { b1: 2 }), 0)
  assert.equal(resolveBlockCommentCount("b1", { b1: -1 }), 0)
})
