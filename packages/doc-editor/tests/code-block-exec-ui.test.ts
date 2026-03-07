import assert from "node:assert/strict"
import { test } from "node:test"

import {
  mapCodeExecStatusLabel,
  resolveCodeExecButtonState,
} from "../src/nodes/code-block-node/code-block-exec-ui"

test("resolveCodeExecButtonState disables button when not editable or running", () => {
  assert.equal(
    resolveCodeExecButtonState({
      editable: false,
      running: false,
    }).disabled,
    true
  )
  assert.equal(
    resolveCodeExecButtonState({
      editable: true,
      running: true,
    }).disabled,
    true
  )
  assert.equal(
    resolveCodeExecButtonState({
      editable: true,
      running: false,
    }).disabled,
    false
  )
})

test("mapCodeExecStatusLabel maps known run status labels", () => {
  assert.equal(mapCodeExecStatusLabel("completed"), "最近成功")
  assert.equal(mapCodeExecStatusLabel("failed"), "最近失败")
  assert.equal(mapCodeExecStatusLabel("timeout"), "最近超时")
  assert.equal(mapCodeExecStatusLabel("unknown"), "")
})
