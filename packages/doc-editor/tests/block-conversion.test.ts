import assert from "node:assert/strict"
import { test } from "node:test"
import type { JSONContent } from "@tiptap/react"

import {
  convertTopLevelTextBlock,
  getConvertibleTargetTypes,
  resolveCurrentBlockConvertType,
  type ConvertibleTextBlockType,
} from "../src/extensions/block-conversion"

function extractPlainText(node: JSONContent | undefined): string {
  if (!node) {
    return ""
  }
  if (node.type === "text" && typeof node.text === "string") {
    return node.text
  }
  if (node.type === "hardBreak") {
    return "\n"
  }
  const content = Array.isArray(node.content) ? node.content : []
  return content.map((child) => extractPlainText(child)).join("")
}

test("block conversion: resolve heading collapsible type", () => {
  const type = resolveCurrentBlockConvertType({
    type: "heading",
    attrs: { level: 1, collapsible: true },
  })
  assert.equal(type, "collapsible-heading-1")
})

test("block conversion: target list excludes current type", () => {
  const targets = getConvertibleTargetTypes("heading-1")
  assert.equal(targets.includes("heading-1"), false)
  assert.equal(targets.includes("heading-2"), true)
})

test("block conversion: list to paragraph merges items with newline", () => {
  const source: JSONContent = {
    type: "bulletList",
    content: [
      {
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
      },
      {
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
      },
    ],
  }
  const converted = convertTopLevelTextBlock({
    source,
    targetType: "paragraph",
  })
  assert.equal(converted.type, "paragraph")
  assert.equal(extractPlainText(converted), "A\nB")
})

test("block conversion: paragraph multiline to ordered list splits items", () => {
  const source: JSONContent = {
    type: "paragraph",
    content: [{ type: "text", text: "A\nB" }],
  }
  const converted = convertTopLevelTextBlock({
    source,
    targetType: "ordered-list",
  })

  assert.equal(converted.type, "orderedList")
  assert.equal(converted.content?.length, 2)
  assert.equal(extractPlainText(converted.content?.[0]), "A")
  assert.equal(extractPlainText(converted.content?.[1]), "B")
})

test("block conversion: heading to collapsible heading keeps marks", () => {
  const source: JSONContent = {
    type: "heading",
    attrs: {
      level: 1,
      id: "h1",
      backgroundColor: "var(--tt-color-highlight-yellow)",
      textColor: "var(--tt-color-text-red)",
    },
    content: [
      {
        type: "text",
        text: "Title",
        marks: [{ type: "bold" }],
      },
    ],
  }

  const converted = convertTopLevelTextBlock({
    source,
    targetType: "collapsible-heading-1",
  })

  assert.equal(converted.type, "heading")
  assert.equal(converted.attrs?.level, 1)
  assert.equal(converted.attrs?.collapsible, true)
  assert.equal(converted.attrs?.id, "h1")
  assert.equal(
    converted.attrs?.backgroundColor,
    "var(--tt-color-highlight-yellow)"
  )
  assert.equal(converted.attrs?.textColor, "var(--tt-color-text-red)")
  assert.deepEqual(converted.content?.[0]?.marks, [{ type: "bold" }])
  assert.equal(extractPlainText(converted), "Title")
})

test("block conversion: paragraph to code block downgrades marks to text", () => {
  const source: JSONContent = {
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "const x = 1;",
        marks: [{ type: "italic" }],
      },
    ],
  }
  const converted = convertTopLevelTextBlock({
    source,
    targetType: "code-block",
  })

  assert.equal(converted.type, "codeBlock")
  assert.equal(converted.content?.[0]?.type, "text")
  assert.equal(converted.content?.[0]?.text, "const x = 1;")
  assert.equal(converted.content?.[0]?.marks, undefined)
})

test("block conversion: all convertible types are accepted", () => {
  const currentTypes: ConvertibleTextBlockType[] = [
    "paragraph",
    "heading-1",
    "collapsible-heading-1",
    "heading-2",
    "collapsible-heading-2",
    "heading-3",
    "collapsible-heading-3",
    "bullet-list",
    "ordered-list",
    "task-list",
    "blockquote",
    "code-block",
  ]
  for (const current of currentTypes) {
    const targets = getConvertibleTargetTypes(current)
    assert.equal(targets.includes(current), false)
    assert.equal(targets.length, currentTypes.length - 1)
  }
})
