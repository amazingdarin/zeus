import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeTrashAutoCleanupDays } from "../src/features/settings/trash-settings";

test("normalizeTrashAutoCleanupDays clamps to valid range", () => {
  assert.equal(normalizeTrashAutoCleanupDays(undefined, 30), 30);
  assert.equal(normalizeTrashAutoCleanupDays("", 30), 1);
  assert.equal(normalizeTrashAutoCleanupDays(0, 30), 1);
  assert.equal(normalizeTrashAutoCleanupDays(30, 30), 30);
  assert.equal(normalizeTrashAutoCleanupDays(3651, 30), 3650);
});
