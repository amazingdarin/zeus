import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/chat/README.md",
  "tests/harness/chat/api/README.md",
  "tests/harness/chat/api/session-smoke.mjs",
  "tests/harness/chat/api/stream-smoke.mjs",
  "tests/fixtures/chat/README.md",
];

test("chat api harness files exist", () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
