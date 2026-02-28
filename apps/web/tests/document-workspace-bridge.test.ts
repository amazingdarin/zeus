import assert from "node:assert/strict";
import { test } from "node:test";

import { toSelectionRange } from "../src/features/document-tabs/workspace-bridge";

test("toSelectionRange maps selection object", () => {
  assert.deepEqual(toSelectionRange({ from: 3, to: 8 }), { from: 3, to: 8 });
});

test("toSelectionRange keeps nullish selection as null", () => {
  assert.equal(toSelectionRange(null), null);
  assert.equal(toSelectionRange(undefined), null);
});
