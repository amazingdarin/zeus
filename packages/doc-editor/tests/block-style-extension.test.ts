import assert from "node:assert/strict"
import { test } from "node:test"

import {
  resolveBlockStyleColorInput,
} from "../src/extensions/node-background-extension"
import { buildBlockStyleMenuState } from "../src/ui/block-style-menu"

test("resolveBlockStyleColorInput rejects non-allowlist values", () => {
  assert.equal(
    resolveBlockStyleColorInput(
      "background",
      "var(--tt-color-highlight-green)"
    ),
    "var(--tt-color-highlight-green)"
  )
  assert.equal(resolveBlockStyleColorInput("background", "#00ff00"), null)
  assert.equal(
    resolveBlockStyleColorInput("text", "var(--tt-color-text-blue)"),
    "var(--tt-color-text-blue)"
  )
  assert.equal(resolveBlockStyleColorInput("text", "blue"), null)
})

test("buildBlockStyleMenuState returns mixed when multiple values selected", () => {
  const mixed = buildBlockStyleMenuState([
    "var(--tt-color-text-blue)",
    "var(--tt-color-text-red)",
  ])
  assert.equal(mixed.kind, "mixed")

  const single = buildBlockStyleMenuState(["var(--tt-color-text-blue)"])
  assert.deepEqual(single, {
    kind: "single",
    value: "var(--tt-color-text-blue)",
  })

  const empty = buildBlockStyleMenuState([null, undefined, ""])
  assert.deepEqual(empty, { kind: "empty" })
})
