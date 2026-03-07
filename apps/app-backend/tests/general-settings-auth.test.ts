import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveSyncMode } from "../src/services/general-settings-auth.ts";

test("general-settings-auth: unauthenticated request always resolves local_only", () => {
  const mode = resolveSyncMode({
    isAuthenticated: false,
    documentAutoSync: true,
  });
  assert.equal(mode, "local_only");
});

test("general-settings-auth: authenticated + autoSync=false resolves local_only", () => {
  const mode = resolveSyncMode({
    isAuthenticated: true,
    documentAutoSync: false,
  });
  assert.equal(mode, "local_only");
});

test("general-settings-auth: authenticated + autoSync=true resolves remote_enabled", () => {
  const mode = resolveSyncMode({
    isAuthenticated: true,
    documentAutoSync: true,
  });
  assert.equal(mode, "remote_enabled");
});

