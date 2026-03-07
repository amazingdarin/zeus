import assert from "node:assert/strict"
import { test } from "node:test"

import { syncEditorEditableState } from "../src/extensions/editable-sync"

type MockEditor = {
  isEditable: boolean
  isDestroyed?: boolean
  setEditable: (next: boolean) => void
}

test("skips when editor is unavailable", () => {
  assert.doesNotThrow(() => {
    syncEditorEditableState(null, true)
  })
})

test("skips when editor is destroyed", () => {
  let called = false
  const editor: MockEditor = {
    isEditable: false,
    isDestroyed: true,
    setEditable: () => {
      called = true
    },
  }

  syncEditorEditableState(editor, true)
  assert.equal(called, false)
})

test("skips when target editable state is unchanged", () => {
  let called = false
  const editor: MockEditor = {
    isEditable: true,
    setEditable: () => {
      called = true
    },
  }

  syncEditorEditableState(editor, true)
  assert.equal(called, false)
})

test("updates editor editable state when mode toggles", () => {
  const calls: boolean[] = []
  const editor: MockEditor = {
    isEditable: false,
    setEditable: (next) => {
      calls.push(next)
      editor.isEditable = next
    },
  }

  syncEditorEditableState(editor, true)
  syncEditorEditableState(editor, false)

  assert.deepEqual(calls, [true, false])
})
