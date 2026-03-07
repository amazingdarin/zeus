import assert from "node:assert/strict";
import { test } from "node:test";

import { mapSaveStatusText } from "../src/features/document-editor/workspace-model";
import { mapEditorSaveBadge } from "../src/components/DocumentHeader";

test("maps workspace save status text", () => {
  assert.equal(mapSaveStatusText("draft"), "草稿");
  assert.equal(mapSaveStatusText("idle"), "已保存");
  assert.equal(mapSaveStatusText("dirty"), "待保存");
  assert.equal(mapSaveStatusText("saving"), "保存中...");
  assert.equal(mapSaveStatusText("error"), "保存失败");
});

test("maps header save badge text", () => {
  assert.equal(mapEditorSaveBadge("draft"), "草稿");
  assert.equal(mapEditorSaveBadge("idle"), "已保存");
  assert.equal(mapEditorSaveBadge("dirty"), "待保存");
  assert.equal(mapEditorSaveBadge("saving"), "保存中");
  assert.equal(mapEditorSaveBadge("error"), "保存失败");
});
