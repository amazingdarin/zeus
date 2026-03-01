import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DOCUMENT_BLOCK_SHORTCUTS,
  hasLongerShortcutPrefix,
  resolveDocumentBlockShortcuts,
  matchSlashShortcutToken,
} from "../src/extensions/block-shortcuts";

test("document block shortcuts: defaults are provided when input is empty", () => {
  const resolved = resolveDocumentBlockShortcuts(undefined);

  assert.equal(resolved.keyToBlockMap["1"], "heading-1");
  assert.equal(resolved.keyToBlockMap["2"], "heading-2");
  assert.equal(resolved.keyToBlockMap["3"], "heading-3");
  assert.equal(resolved.keyToBlockMap["0"], "paragraph");
  assert.equal(resolved.keyToBlockMap["4"], "toggle-block");
  assert.equal(resolved.keyToBlockMap.col, "columns");
  assert.equal(DEFAULT_DOCUMENT_BLOCK_SHORTCUTS["1"], "heading-1");
});

test("document block shortcuts: invalid entries are ignored", () => {
  const resolved = resolveDocumentBlockShortcuts({
    "1": "heading-1",
    "1>": "heading-2",
    "/": "paragraph",
    "a/": "paragraph",
    x: "unknown",
    " ": "heading-3",
  } as Record<string, string>);

  assert.equal(resolved.keyToBlockMap["1"], "heading-1");
  assert.equal(resolved.keyToBlockMap["1>"], "heading-2");
  assert.equal(resolved.keyToBlockMap["/"], undefined);
  assert.equal(resolved.keyToBlockMap["a/"], undefined);
  assert.equal(resolved.keyToBlockMap.x, undefined);
});

test("document block shortcuts: duplicate block mapping keeps first key only", () => {
  const resolved = resolveDocumentBlockShortcuts({
    "1": "heading-1",
    h: "heading-1",
    "2": "heading-2",
  });

  assert.equal(resolved.keyToBlockMap["1"], "heading-1");
  assert.equal(resolved.keyToBlockMap.h, undefined);
  assert.equal(resolved.blockToKeyMap["heading-1"], "1");
});

test("document block shortcuts: missing defaults are backfilled for new block types", () => {
  const resolved = resolveDocumentBlockShortcuts({
    "1": "heading-1",
    "2": "heading-2",
    "3": "heading-3",
    "0": "paragraph",
    "4": "toggle-block",
  });

  assert.equal(resolved.blockToKeyMap["collapsible-heading-1"], "1>");
  assert.equal(resolved.blockToKeyMap["collapsible-heading-2"], "2>");
  assert.equal(resolved.blockToKeyMap["collapsible-heading-3"], "3>");
});

test("document block shortcuts: slash token resolves mapped block", () => {
  const resolved = resolveDocumentBlockShortcuts({
    "1": "heading-1",
    "1>": "collapsible-heading-1",
    p: "paragraph",
    col: "columns",
  });

  assert.equal(
    matchSlashShortcutToken({
      token: "/1",
      keyToBlockMap: resolved.keyToBlockMap,
    }),
    "heading-1"
  );
  assert.equal(
    matchSlashShortcutToken({
      token: "/p",
      keyToBlockMap: resolved.keyToBlockMap,
    }),
    "paragraph"
  );
  assert.equal(
    matchSlashShortcutToken({
      token: "/1>",
      keyToBlockMap: resolved.keyToBlockMap,
    }),
    "collapsible-heading-1"
  );
  assert.equal(
    matchSlashShortcutToken({
      token: "/col",
      keyToBlockMap: resolved.keyToBlockMap,
    }),
    "columns"
  );
  assert.equal(
    matchSlashShortcutToken({
      token: "/9",
      keyToBlockMap: resolved.keyToBlockMap,
    }),
    null
  );
});

test("document block shortcuts: prefix detection finds longer candidate", () => {
  const resolved = resolveDocumentBlockShortcuts({
    "1": "heading-1",
    "1>": "collapsible-heading-1",
  });

  assert.equal(
    hasLongerShortcutPrefix({
      shortcut: "1",
      keyToBlockMap: resolved.keyToBlockMap,
    }),
    true
  );
  assert.equal(
    hasLongerShortcutPrefix({
      shortcut: "1>",
      keyToBlockMap: resolved.keyToBlockMap,
    }),
    false
  );
});
