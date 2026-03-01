import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createDefaultColumnWidths,
  normalizeColumnsCount,
  normalizeColumnsWidths,
  resizeColumnsJson,
} from "../src/nodes/columns-node/columns-transform"

test("normalizeColumnsCount clamps unsupported values into 2..8 range", () => {
  assert.equal(normalizeColumnsCount(1), 2)
  assert.equal(normalizeColumnsCount(2), 2)
  assert.equal(normalizeColumnsCount(8), 8)
  assert.equal(normalizeColumnsCount(9), 8)
  assert.equal(normalizeColumnsCount("3"), 3)
  assert.equal(normalizeColumnsCount("bad"), 2)
})

test("normalizeColumnsWidths and defaults align with target count", () => {
  assert.deepEqual(createDefaultColumnWidths(2), [1, 1])
  assert.deepEqual(createDefaultColumnWidths(8), [1, 1, 1, 1, 1, 1, 1, 1])
  assert.deepEqual(normalizeColumnsWidths([2, 1], 3), [2, 1, 1])
  assert.deepEqual(normalizeColumnsWidths("2, 0, bad, 3", 4), [2, 1, 1, 3])
})

test("resizeColumnsJson appends empty columns when expanding", () => {
  const node = {
    type: "columns",
    attrs: { count: 2 },
    content: [
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
    ],
  } as const

  const next = resizeColumnsJson(node, 4)

  assert.equal(next.attrs?.count, 4)
  assert.deepEqual(next.attrs?.widths, [1, 1, 1, 1])
  assert.equal(next.content?.length, 4)
  assert.equal(next.content?.[2]?.type, "column")
  assert.equal(next.content?.[2]?.content?.[0]?.type, "paragraph")
})

test("resizeColumnsJson shrinks and merges removed column content into last kept column", () => {
  const node = {
    type: "columns",
    attrs: { count: 4, widths: [3, 2, 1, 1] },
    content: [
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "C" }] }] },
      { type: "column", content: [{ type: "paragraph", content: [{ type: "text", text: "D" }] }] },
    ],
  } as const

  const next = resizeColumnsJson(node, 2)

  assert.equal(next.attrs?.count, 2)
  assert.deepEqual(next.attrs?.widths, [3, 2])
  assert.equal(next.content?.length, 2)
  assert.equal(next.content?.[1]?.type, "column")
  assert.equal(next.content?.[1]?.content?.length, 3)
  assert.equal(next.content?.[1]?.content?.[1]?.content?.[0]?.text, "C")
  assert.equal(next.content?.[1]?.content?.[2]?.content?.[0]?.text, "D")
})
