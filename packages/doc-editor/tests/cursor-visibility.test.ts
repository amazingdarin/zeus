import assert from "node:assert/strict";
import { test } from "node:test";

import { getEditorViewIfAvailable } from "../src/hooks/use-cursor-visibility";

test("returns null when editor is unavailable", () => {
  assert.equal(getEditorViewIfAvailable(null), null);
});

test("returns null when editor is destroyed", () => {
  const editor = {
    isDestroyed: true,
    get view() {
      throw new Error("view should not be read");
    },
  };
  assert.equal(getEditorViewIfAvailable(editor as never), null);
});

test("returns null when editor view getter throws during mount", () => {
  const editor = {
    isDestroyed: false,
    get view() {
      throw new Error("view not ready");
    },
  };
  assert.equal(getEditorViewIfAvailable(editor as never), null);
});

test("returns editor view when available", () => {
  const view = { hasFocus: () => false };
  const editor = {
    isDestroyed: false,
    view,
  };
  assert.equal(getEditorViewIfAvailable(editor as never), view);
});
