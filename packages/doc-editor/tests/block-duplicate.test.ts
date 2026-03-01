import assert from "node:assert/strict"
import { test } from "node:test"
import type { JSONContent } from "@tiptap/react"

import {
  cloneBlockNodeForDuplicate,
  duplicateTopLevelBlockJson,
} from "../src/extensions/block-duplicate"

test("clone block node for duplicate strips id attrs recursively", () => {
  const source: JSONContent = {
    type: "heading",
    attrs: {
      level: 2,
      id: "heading-1",
      backgroundColor: "var(--tt-color-highlight-green)",
      textColor: "var(--tt-color-text-blue)",
    },
    content: [
      {
        type: "text",
        text: "标题",
      },
    ],
  }

  const cloned = cloneBlockNodeForDuplicate(source)

  assert.equal(cloned.type, "heading")
  assert.equal(cloned.attrs?.id, undefined)
  assert.equal(cloned.attrs?.level, 2)
  assert.equal(
    cloned.attrs?.backgroundColor,
    "var(--tt-color-highlight-green)"
  )
  assert.equal(cloned.attrs?.textColor, "var(--tt-color-text-blue)")
})

test("duplicate top-level block inserts copied block after source", () => {
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: {
          id: "p-1",
          backgroundColor: "var(--tt-color-highlight-green)",
          textColor: "var(--tt-color-text-blue)",
        },
        content: [{ type: "text", text: "第一段" }],
      },
      {
        type: "paragraph",
        attrs: { id: "p-2" },
        content: [{ type: "text", text: "第二段" }],
      },
    ],
  }

  const result = duplicateTopLevelBlockJson(doc, "p-1")

  assert.equal(result.changed, true)
  assert.equal(result.content.length, 3)
  assert.equal(result.content[0]?.attrs?.id, "p-1")
  assert.equal(result.content[1]?.type, "paragraph")
  assert.equal(result.content[1]?.attrs?.id, undefined)
  assert.equal(
    result.content[1]?.attrs?.backgroundColor,
    "var(--tt-color-highlight-green)"
  )
  assert.equal(
    result.content[1]?.attrs?.textColor,
    "var(--tt-color-text-blue)"
  )
  assert.equal(result.content[1]?.content?.[0]?.type, "text")
  assert.equal(result.content[1]?.content?.[0]?.text, "第一段")
  assert.equal(result.content[2]?.attrs?.id, "p-2")
})

test("duplicate top-level block returns unchanged when source is missing", () => {
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "p-1" },
      },
    ],
  }

  const result = duplicateTopLevelBlockJson(doc, "missing")

  assert.equal(result.changed, false)
  assert.equal(result.content, doc.content)
})
