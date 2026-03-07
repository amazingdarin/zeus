import assert from "node:assert/strict";
import test from "node:test";

import { mapDocumentLockViewState } from "../src/features/document-page/lock-view-state";

test("locked doc maps to readonly ui state", () => {
  const state = mapDocumentLockViewState({
    locked: true,
    lockedBy: "u1",
    lockedAt: "2026-03-02T00:00:00.000Z",
  });
  assert.equal(state.readonly, true);
  assert.equal(state.showLockBadge, true);
});

test("unlocked doc maps to editable ui state", () => {
  const state = mapDocumentLockViewState(null);
  assert.equal(state.readonly, false);
  assert.equal(state.showLockBadge, false);
});
