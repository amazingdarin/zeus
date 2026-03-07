import assert from "node:assert/strict";
import { test } from "node:test";

import {
  shouldApplyIncomingWorkspaceState,
  shouldFlushOn,
} from "../src/features/document-editor/workspace-model";

test("flushes on route-leave and project-switch", () => {
  assert.equal(shouldFlushOn("route-leave"), true);
  assert.equal(shouldFlushOn("project-switch"), true);
  assert.equal(shouldFlushOn("window-blur"), true);
  assert.equal(shouldFlushOn("input"), false);
});

test("does not overwrite local dirty/saving/error workspace state with incoming stale props", () => {
  assert.equal(
    shouldApplyIncomingWorkspaceState({
      saveStatus: "dirty",
      incomingTitle: "server-title",
      localTitle: "local-title",
      incomingSerialized: "{\"type\":\"doc\",\"content\":[]}",
      localSerialized: "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
      force: false,
    }),
    false,
  );

  assert.equal(
    shouldApplyIncomingWorkspaceState({
      saveStatus: "saving",
      incomingTitle: "server-title",
      localTitle: "local-title",
      incomingSerialized: "{\"type\":\"doc\",\"content\":[]}",
      localSerialized: "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
      force: false,
    }),
    false,
  );

  assert.equal(
    shouldApplyIncomingWorkspaceState({
      saveStatus: "error",
      incomingTitle: "server-title",
      localTitle: "local-title",
      incomingSerialized: "{\"type\":\"doc\",\"content\":[]}",
      localSerialized: "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
      force: false,
    }),
    false,
  );
});

test("syncs incoming props only when idle or forced", () => {
  assert.equal(
    shouldApplyIncomingWorkspaceState({
      saveStatus: "idle",
      incomingTitle: "server-title",
      localTitle: "local-title",
      incomingSerialized: "{\"type\":\"doc\",\"content\":[]}",
      localSerialized: "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
      force: false,
    }),
    true,
  );

  assert.equal(
    shouldApplyIncomingWorkspaceState({
      saveStatus: "dirty",
      incomingTitle: "same",
      localTitle: "same",
      incomingSerialized: "{\"type\":\"doc\",\"content\":[]}",
      localSerialized: "{\"type\":\"doc\",\"content\":[]}",
      force: true,
    }),
    true,
  );

  assert.equal(
    shouldApplyIncomingWorkspaceState({
      saveStatus: "idle",
      incomingTitle: "same",
      localTitle: "same",
      incomingSerialized: "{\"type\":\"doc\",\"content\":[]}",
      localSerialized: "{\"type\":\"doc\",\"content\":[]}",
      force: false,
    }),
    false,
  );
});
