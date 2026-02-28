import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DOCUMENT_BLOCK_SHORTCUTS,
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
  assert.equal(DEFAULT_DOCUMENT_BLOCK_SHORTCUTS["1"], "heading-1");
});

test("document block shortcuts: invalid entries are ignored", () => {
  const resolved = resolveDocumentBlockShortcuts({
    "1": "heading-1",
    "12": "heading-2",
    "/": "paragraph",
    x: "unknown",
    " ": "heading-3",
  } as Record<string, string>);

  assert.equal(resolved.keyToBlockMap["1"], "heading-1");
  assert.equal(resolved.keyToBlockMap["12"], undefined);
  assert.equal(resolved.keyToBlockMap["/"], undefined);
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

test("document block shortcuts: slash token resolves mapped block", () => {
  const resolved = resolveDocumentBlockShortcuts({
    "1": "heading-1",
    p: "paragraph",
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
      token: "/9",
      keyToBlockMap: resolved.keyToBlockMap,
    }),
    null
  );
});
