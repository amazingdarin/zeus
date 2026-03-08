import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const files = [
  "tests/harness/plugins/README.md",
  "tests/harness/plugins/api/README.md",
  "tests/harness/plugins/api/install-smoke.mjs",
  "tests/harness/plugins/api/runtime-smoke.mjs",
  "tests/harness/plugins/api/local-data-smoke.mjs",
  "tests/fixtures/plugins/README.md",
];

test("plugin api harness files exist", () => {
  for (const relativePath of files) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} should exist`);
  }
});
