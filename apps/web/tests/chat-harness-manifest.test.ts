import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/chat/README.md",
  "tests/harness/chat/playwright/README.md",
  "tests/harness/chat/playwright/smoke.mjs",
  "tests/fixtures/chat/README.md",
];

test("chat web harness files exist", () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
