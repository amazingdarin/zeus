import assert from "node:assert/strict"
import { test } from "node:test"

import { buildStandaloneBuiltinBlockContent } from "../src/extensions/builtin-block-content"
import type { BuiltinBlockType } from "../src/extensions/block-add-handle"

test("standalone insertion: non-toggle block content is a single top-level node", () => {
  const types: BuiltinBlockType[] = [
    "paragraph",
    "heading-1",
    "heading-2",
    "heading-3",
    "bullet-list",
    "ordered-list",
    "task-list",
    "blockquote",
    "horizontal-rule",
    "code-block",
    "image",
    "file",
    "table",
  ]

  for (const type of types) {
    const content = buildStandaloneBuiltinBlockContent(type)
    assert.equal(Array.isArray(content), false, `${type} should not append sibling paragraph`)
  }
})

test("standalone insertion: toggle block keeps heading + paragraph structure", () => {
  const content = buildStandaloneBuiltinBlockContent("toggle-block")
  assert.equal(Array.isArray(content), true)
  assert.equal(content[0]?.type, "heading")
  assert.equal(content[1]?.type, "paragraph")
})

test("standalone insertion: ordered list starts with one empty list item", () => {
  const content = buildStandaloneBuiltinBlockContent("ordered-list")
  assert.equal(Array.isArray(content), false)
  assert.equal(content.type, "orderedList")
  assert.equal(content.content?.[0]?.type, "listItem")
  assert.equal(content.content?.[0]?.content?.[0]?.type, "paragraph")
})

test("standalone insertion: task list starts with one unchecked task item", () => {
  const content = buildStandaloneBuiltinBlockContent("task-list")
  assert.equal(Array.isArray(content), false)
  assert.equal(content.type, "taskList")
  assert.equal(content.content?.[0]?.type, "taskItem")
  assert.equal(content.content?.[0]?.attrs?.checked, false)
})

test("standalone insertion: table uses a 3x3 structure with header row", () => {
  const content = buildStandaloneBuiltinBlockContent("table")
  assert.equal(Array.isArray(content), false)
  assert.equal(content.type, "table")
  assert.equal(content.content?.length, 3)
  assert.equal(content.content?.[0]?.type, "tableRow")
  assert.equal(content.content?.[0]?.content?.[0]?.type, "tableHeader")
  assert.equal(content.content?.[1]?.content?.[0]?.type, "tableCell")
})
