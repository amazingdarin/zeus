import assert from "node:assert/strict"
import { test } from "node:test"

import {
  BLOCK_BACKGROUND_COLOR_VALUES,
  BLOCK_TEXT_COLOR_VALUES,
  isAllowedBlockBackgroundColor,
  isAllowedBlockTextColor,
} from "../src/extensions/block-style-palette"

test("block style palette allows predefined values only", () => {
  assert.equal(BLOCK_BACKGROUND_COLOR_VALUES.length > 0, true)
  assert.equal(BLOCK_TEXT_COLOR_VALUES.length > 0, true)

  assert.equal(
    isAllowedBlockBackgroundColor("var(--tt-color-highlight-blue)"),
    true
  )
  assert.equal(isAllowedBlockBackgroundColor("#ff0000"), false)

  assert.equal(isAllowedBlockTextColor("var(--tt-color-text-red)"), true)
  assert.equal(isAllowedBlockTextColor("rgb(1,2,3)"), false)
})
