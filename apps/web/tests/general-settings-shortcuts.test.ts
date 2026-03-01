import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DOCUMENT_BLOCK_SHORTCUTS,
  buildShortcutConflictMap,
  sanitizeDocumentBlockShortcuts,
  toShortcutPayload,
} from "../src/constants/document-block-shortcuts";

test("general-settings-shortcuts: sanitize falls back to defaults for undefined", () => {
  const sanitized = sanitizeDocumentBlockShortcuts(undefined);
  assert.deepEqual(sanitized, DEFAULT_DOCUMENT_BLOCK_SHORTCUTS);
});

test("general-settings-shortcuts: sanitize removes invalid keys and block types", () => {
  const sanitized = sanitizeDocumentBlockShortcuts({
    "1": "heading-1",
    "1>": "collapsible-heading-1",
    "/": "paragraph",
    "a/": "paragraph",
    x: "unknown",
  });
  assert.deepEqual(sanitized, {
    "1": "heading-1",
    "1>": "collapsible-heading-1",
  });
});

test("general-settings-shortcuts: conflict map detects duplicate shortcuts", () => {
  const conflictMap = buildShortcutConflictMap({
    "heading-1": "1",
    "heading-2": "1",
    paragraph: "0",
  });
  assert.equal(conflictMap["heading-1"], true);
  assert.equal(conflictMap["heading-2"], true);
  assert.equal(conflictMap.paragraph, false);
});

test("general-settings-shortcuts: payload converts block-key map to key-block map", () => {
  const payload = toShortcutPayload({
    "heading-1": "1",
    "collapsible-heading-1": "1>",
    paragraph: "0",
  });
  assert.deepEqual(payload, {
    "1": "heading-1",
    "1>": "collapsible-heading-1",
    "0": "paragraph",
  });
});
