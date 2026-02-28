import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createSnapshotStore,
  removeSnapshot,
  upsertSnapshot,
} from "../src/features/document-tabs/snapshot-store";

test("upsertSnapshot writes by doc id", () => {
  let store = createSnapshotStore();
  store = upsertSnapshot(store, "a", {
    scrollTop: 100,
    selection: { from: 1, to: 3 },
    draftTitle: "A",
    draftContent: { type: "doc", content: [] },
    saveStatus: "dirty",
  });
  assert.equal(store.a?.scrollTop, 100);
  assert.deepEqual(store.a?.selection, { from: 1, to: 3 });
});

test("removeSnapshot deletes key", () => {
  let store = createSnapshotStore();
  store = upsertSnapshot(store, "a", {
    scrollTop: 0,
    selection: null,
    draftTitle: "",
    draftContent: { type: "doc", content: [] },
    saveStatus: "idle",
  });
  store = removeSnapshot(store, "a");
  assert.equal("a" in store, false);
});
