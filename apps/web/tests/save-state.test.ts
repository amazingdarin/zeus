import assert from "node:assert/strict";
import { test } from "node:test";

import { initialSaveState, reduceSaveState } from "../src/features/document-editor/save-state";

test("transitions dirty -> saving -> idle", () => {
  let state = initialSaveState();
  state = reduceSaveState(state, { type: "changed" });
  state = reduceSaveState(state, { type: "save-start" });
  state = reduceSaveState(state, { type: "save-success" });
  assert.equal(state.status, "idle");
});

test("save error sets status and error message", () => {
  let state = initialSaveState();
  state = reduceSaveState(state, { type: "save-error", error: "network down" });
  assert.equal(state.status, "error");
  assert.equal(state.error, "network down");
});
