import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DOCUMENT_BLOCK_SHORTCUTS,
  sanitizeDocumentBlockShortcuts,
  validateDocumentBlockShortcutsInput,
} from "../src/services/general-settings-shortcuts.ts";

test("general-settings-shortcuts: sanitize uses defaults for undefined input", () => {
  const shortcuts = sanitizeDocumentBlockShortcuts(undefined);
  assert.deepEqual(shortcuts, DEFAULT_DOCUMENT_BLOCK_SHORTCUTS);
});

test("general-settings-shortcuts: sanitize removes invalid entries", () => {
  const shortcuts = sanitizeDocumentBlockShortcuts({
    "1": "heading-1",
    "1>": "collapsible-heading-1",
    "/": "paragraph",
    "a/": "paragraph",
    x: "unknown",
  });

  assert.deepEqual(shortcuts, {
    "1": "heading-1",
    "1>": "collapsible-heading-1",
  });
});

test("general-settings-shortcuts: validate accepts multi-char shortcuts", () => {
  const result = validateDocumentBlockShortcutsInput({
    "1": "heading-1",
    "1>": "collapsible-heading-1",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      "1": "heading-1",
      "1>": "collapsible-heading-1",
    });
  }
});

test("general-settings-shortcuts: validate rejects duplicated block mappings", () => {
  const result = validateDocumentBlockShortcutsInput({
    "1": "heading-1",
    h: "heading-1",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.message, /duplicate/i);
  }
});

test("general-settings-shortcuts: validate accepts empty object", () => {
  const result = validateDocumentBlockShortcutsInput({});
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {});
  }
});
