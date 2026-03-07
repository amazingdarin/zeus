import assert from "node:assert/strict"
import { test } from "node:test"

import {
  getBlockTypePlaceholderText,
  shouldDecorateBlockTypePlaceholder,
} from "../src/extensions/BlockTypePlaceholderExtension"

test("maps empty paragraph to paragraph placeholder", () => {
  assert.equal(
    getBlockTypePlaceholderText({
      nodeType: "paragraph",
    }),
    "可以通过/唤醒命令"
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

test("only decorates empty paragraph placeholder when cursor is inside the paragraph", () => {
  assert.equal(
    shouldDecorateBlockTypePlaceholder({
      nodeType: "paragraph",
      parentType: "doc",
      nodePos: 5,
      nodeSize: 2,
      selectionFrom: 6,
      selectionTo: 6,
    }),
    true
  )
  assert.equal(
    shouldDecorateBlockTypePlaceholder({
      nodeType: "paragraph",
      parentType: "doc",
      nodePos: 5,
      nodeSize: 2,
      selectionFrom: 4,
      selectionTo: 4,
    }),
    false
  )
  assert.equal(
    shouldDecorateBlockTypePlaceholder({
      nodeType: "paragraph",
      parentType: "doc",
      nodePos: 5,
      nodeSize: 2,
      selectionFrom: 6,
      selectionTo: 7,
    }),
    false
  )
})

test("only decorates top-level heading placeholders", () => {
  assert.equal(
    shouldDecorateBlockTypePlaceholder({
      nodeType: "heading",
      parentType: "doc",
    }),
    true
  )
  assert.equal(
    shouldDecorateBlockTypePlaceholder({
      nodeType: "heading",
      parentType: "blockquote",
    }),
    false
  )
})
