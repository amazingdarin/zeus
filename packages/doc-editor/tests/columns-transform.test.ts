import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createDefaultColumnWidths,
  normalizeColumnsCount,
  normalizeColumnsWidths,
  resolveColumnResizeHandleLayouts,
  resizeAdjacentColumnsWidths,
  resolveColumnResizeHandlePercents,
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

test("resizeAdjacentColumnsWidths updates only adjacent columns and keeps total width", () => {
  const next = resizeAdjacentColumnsWidths({
    widths: [1, 1, 1],
    count: 3,
    handleIndex: 0,
    containerWidthPx: 900,
    deltaPx: 120,
    minColumnWidthPx: 140,
    gapPx: 12,
  })

  assert.equal(next.length, 3)
  assert.equal(next[2], 1)
  assert.ok(next[0] > 1)
  assert.ok(next[1] < 1)
  const total = Number((next[0] + next[1] + next[2]).toFixed(4))
  assert.equal(total, 3)
})

test("resizeAdjacentColumnsWidths enforces minimum column width clamp", () => {
  const next = resizeAdjacentColumnsWidths({
    widths: [1, 1],
    count: 2,
    handleIndex: 0,
    containerWidthPx: 400,
    deltaPx: -999,
    minColumnWidthPx: 140,
    gapPx: 12,
  })

  const total = next[0] + next[1]
  const availablePx = 400 - 12
  const expectedMin = Number(((140 / availablePx) * total).toFixed(4))
  assert.equal(next[0], expectedMin)
  assert.equal(next[1], Number((total - expectedMin).toFixed(4)))
})

test("resolveColumnResizeHandlePercents returns cumulative split positions", () => {
  assert.deepEqual(resolveColumnResizeHandlePercents([1, 1], 2), [50])
  assert.deepEqual(resolveColumnResizeHandlePercents([2, 1], 2), [66.6667])
  assert.deepEqual(resolveColumnResizeHandlePercents([1, 1, 1], 3), [33.3333, 66.6667])
})

test("resolveColumnResizeHandleLayouts compensates fixed column gaps", () => {
  const layouts = resolveColumnResizeHandleLayouts([2.1, 1.5, 1, 1, 1.1], 5, 12)
  assert.equal(layouts.length, 4)
  assert.deepEqual(
    layouts.map((item) => item.percent),
    [31.3433, 53.7313, 68.6567, 83.5821],
  )
  assert.deepEqual(
    layouts.map((item) => item.offsetPx),
    [-9.0448, -7.791, -2.9552, 1.8806],
  )
})
