import assert from "node:assert/strict"
import { test } from "node:test"

import { normalizeUnsupportedPluginBlocks } from "../src/extensions/UnsupportedPluginBlockExtension"

test("normalizeUnsupportedPluginBlocks keeps columns nodes as known builtins", () => {
  const content = {
    type: "doc",
    content: [
      {
        type: "columns",
        attrs: { count: 2 },
        content: [
          { type: "column", content: [{ type: "paragraph" }] },
          { type: "column", content: [{ type: "paragraph" }] },
        ],
      },
    ],
  }

  const normalized = normalizeUnsupportedPluginBlocks(content)
  assert.equal(normalized.content?.[0]?.type, "columns")
  assert.equal(normalized.content?.[0]?.content?.[0]?.type, "column")
  assert.equal(normalized.content?.[0]?.content?.[0]?.content?.[0]?.type, "paragraph")
})

