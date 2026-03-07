import assert from "node:assert/strict"
import { test } from "node:test"

import { shouldApplyIncomingContentSync } from "../src/extensions/content-sync"

test("skips sync when incoming content already matches last content", () => {
  assert.equal(
    shouldApplyIncomingContentSync({
      incomingSerialized: '{"type":"doc","content":[]}',
      lastSerialized: '{"type":"doc","content":[]}',
      editorSerialized: '{"type":"doc","content":[{"type":"paragraph"}]}',
      editorHasFocus: false,
    }),
    false
  )
})

test("skips sync when incoming content already matches editor content", () => {
  assert.equal(
    shouldApplyIncomingContentSync({
      incomingSerialized: '{"type":"doc","content":[{"type":"paragraph"}]}',
      lastSerialized: '{"type":"doc","content":[]}',
      editorSerialized: '{"type":"doc","content":[{"type":"paragraph"}]}',
      editorHasFocus: false,
    }),
    false
  )
})

test("skips stale overwrite while editor is focused and last snapshot equals editor state", () => {
  assert.equal(
    shouldApplyIncomingContentSync({
      incomingSerialized: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"old"}]}]}',
      lastSerialized: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"new"}]}]}',
      editorSerialized: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"new"}]}]}',
      editorHasFocus: true,
    }),
    false
  )
})

test("applies sync when editor is not focused and incoming differs from local snapshots", () => {
  assert.equal(
    shouldApplyIncomingContentSync({
      incomingSerialized: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"remote"}]}]}',
      lastSerialized: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"local"}]}]}',
      editorSerialized: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"local"}]}]}',
      editorHasFocus: false,
    }),
    true
  )
})
