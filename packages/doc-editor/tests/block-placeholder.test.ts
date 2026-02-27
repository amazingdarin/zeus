import assert from "node:assert/strict"
import { test } from "node:test"

import { getBlockTypePlaceholderText } from "../src/extensions/BlockTypePlaceholderExtension"

test("maps empty paragraph to paragraph placeholder", () => {
  assert.equal(
    getBlockTypePlaceholderText({
      nodeType: "paragraph",
    }),
    "段落"
  )
})

test("maps heading level to translucent heading placeholder text", () => {
  assert.equal(
    getBlockTypePlaceholderText({
      nodeType: "heading",
      level: 1,
    }),
    "标题1"
  )
  assert.equal(
    getBlockTypePlaceholderText({
      nodeType: "heading",
      level: 2,
    }),
    "标题2"
  )
  assert.equal(
    getBlockTypePlaceholderText({
      nodeType: "heading",
      level: 6,
    }),
    "标题6"
  )
})

test("clamps invalid heading levels to supported range", () => {
  assert.equal(
    getBlockTypePlaceholderText({
      nodeType: "heading",
      level: 0,
    }),
    "标题1"
  )
  assert.equal(
    getBlockTypePlaceholderText({
      nodeType: "heading",
      level: 10,
    }),
    "标题6"
  )
})

test("returns null for unsupported node types", () => {
  assert.equal(
    getBlockTypePlaceholderText({
      nodeType: "blockquote",
    }),
    null
  )
})

