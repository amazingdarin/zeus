import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOCUMENT_TAB_MAX,
  activateTab,
  closeTab,
  createInitialSessionState,
  openTab,
} from "../src/features/document-tabs/session-model";

test("openTab deduplicates existing document tab and updates title", () => {
  let state = createInitialSessionState();
  state = openTab(state, { docId: "a", title: "A", now: 1 });
  state = openTab(state, { docId: "a", title: "A2", now: 2 });
  assert.equal(state.tabs.length, 1);
  assert.equal(state.activeDocId, "a");
  assert.equal(state.tabs[0]?.title, "A2");
});

test("openTab evicts least recently used when max reached", () => {
  let state = createInitialSessionState();
  state = openTab(state, { docId: "a", title: "A", now: 1, maxTabs: 2 });
  state = openTab(state, { docId: "b", title: "B", now: 2, maxTabs: 2 });
  state = activateTab(state, { docId: "a", now: 3 });
  state = openTab(state, { docId: "c", title: "C", now: 4, maxTabs: 2 });
  assert.deepEqual(
    state.tabs.map((tab) => tab.docId).sort(),
    ["a", "c"],
  );
  assert.equal(state.activeDocId, "c");
});

test("closeTab picks fallback active tab by last access time", () => {
  let state = createInitialSessionState();
  state = openTab(state, { docId: "a", title: "A", now: 1 });
  state = openTab(state, { docId: "b", title: "B", now: 2 });
  state = activateTab(state, { docId: "a", now: 3 });
  state = closeTab(state, { docId: "a" });
  assert.equal(state.activeDocId, "b");
});

test("default tab max is 8", () => {
  assert.equal(DOCUMENT_TAB_MAX, 8);
  let state = createInitialSessionState();
  for (let i = 0; i < DOCUMENT_TAB_MAX + 1; i += 1) {
    state = openTab(state, {
      docId: `doc-${i}`,
      title: `Doc ${i}`,
      now: i + 1,
    });
  }
  assert.equal(state.tabs.length, DOCUMENT_TAB_MAX);
});
